"""The Replicate backend, against a fake transport.

Nothing here reaches Replicate. A test that could would spend money on every CI
run, and would fail whenever a hosted model is cold.

The cases are the three that actually bite in production: the polling loop
reaching a terminal state, a prediction that fails, and the two output shapes
(an RGBA cutout versus a greyscale mask) that look identical until one of them
composites as a black rectangle.
"""

from __future__ import annotations

import httpx
import numpy as np
import pytest

from app.backends.base import guided_filter, refine_alpha
from app.backends.replicate import ReplicateMatter, _first_url
from tests.conftest import flat_rgb, gray_png_bytes, png_bytes, solid_alpha

PREDICTION_ID = "pred-1"
OUTPUT_URL = "https://replicate.delivery/out/cutout.png"


def build_transport(
    *,
    statuses: list[str],
    output: object = OUTPUT_URL,
    output_bytes: bytes,
    create_status: int = 201,
    calls: list[httpx.Request] | None = None,
):
    """A transport that walks `statuses` one poll at a time, then serves the file."""
    state = {"i": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request)
        url = str(request.url)

        if request.method == "POST" and "/predictions" in url:
            body: dict = {
                "id": PREDICTION_ID,
                "status": statuses[0],
                "urls": {"get": f"https://api.replicate.com/v1/predictions/{PREDICTION_ID}"},
            }
            # Replicate can return an already-terminal prediction from create
            # (a warm container with `Prefer: wait`), and then there is no poll
            # at all — so the create response has to carry the output.
            if statuses[0] == "succeeded":
                body["output"] = output
            return httpx.Response(create_status, json=body)

        if request.method == "GET" and f"/predictions/{PREDICTION_ID}" in url:
            state["i"] = min(state["i"] + 1, len(statuses) - 1)
            status = statuses[state["i"]]
            body: dict = {"id": PREDICTION_ID, "status": status}
            if status == "succeeded":
                body["output"] = output
            if status == "failed":
                body["error"] = "CUDA out of memory"
            return httpx.Response(200, json=body)

        if url == OUTPUT_URL:
            return httpx.Response(200, content=output_bytes)

        if "/models/" in url:
            return httpx.Response(200, json={"latest_version": {"id": "f" * 64}})

        raise AssertionError(f"unexpected request: {request.method} {url}")

    return httpx.MockTransport(handler)


def rgba_cutout(h: int = 64, w: int = 64) -> bytes:
    """What the model actually returns: a cut-out PNG with an alpha channel."""
    return png_bytes(flat_rgb(h, w, (10, 20, 30)), solid_alpha(h, w, (16, 16, 48, 48)))


def gray_mask(h: int = 64, w: int = 64) -> bytes:
    """What a differently-packaged BiRefNet returns: a greyscale mask."""
    return gray_png_bytes(solid_alpha(h, w, (16, 16, 48, 48)))


# ── the polling loop ────────────────────────────────────────────────────────


async def test_polls_until_succeeded_and_returns_the_alpha(settings):
    transport = build_transport(
        statuses=["starting", "processing", "processing", "succeeded"],
        output_bytes=rgba_cutout(),
    )
    async with httpx.AsyncClient(transport=transport) as client:
        matter = ReplicateMatter(settings, client)
        alpha = await matter.mat_url(OUTPUT_URL, flat_rgb(64, 64), 1024)

    assert alpha.shape == (64, 64)
    assert alpha.dtype == np.float32
    assert alpha.max() == pytest.approx(1.0, abs=1e-6)
    assert alpha[0, 0] == pytest.approx(0.0, abs=1e-6)
    assert alpha[32, 32] == pytest.approx(1.0, abs=1e-6)


async def test_a_failed_prediction_raises_and_does_not_return_a_blank_alpha(settings):
    """The dangerous alternative is returning zeros, which composites as an
    empty canvas and reports as success."""
    transport = build_transport(statuses=["starting", "failed"], output_bytes=rgba_cutout())
    async with httpx.AsyncClient(transport=transport) as client:
        matter = ReplicateMatter(settings, client)
        with pytest.raises(RuntimeError):
            await matter.mat_url(OUTPUT_URL, flat_rgb(64, 64), 1024)


async def test_a_canceled_prediction_raises(settings):
    transport = build_transport(statuses=["starting", "canceled"], output_bytes=rgba_cutout())
    async with httpx.AsyncClient(transport=transport) as client:
        matter = ReplicateMatter(settings, client)
        with pytest.raises(RuntimeError):
            await matter.mat_url(OUTPUT_URL, flat_rgb(64, 64), 1024)


async def test_a_prediction_that_never_finishes_times_out(settings):
    """A wedged prediction would otherwise hold a worker slot forever, and a
    wedged pool looks exactly like 'the feature stopped working'."""
    transport = build_transport(statuses=["processing"], output_bytes=rgba_cutout())
    async with httpx.AsyncClient(transport=transport) as client:
        matter = ReplicateMatter(settings, client)
        with pytest.raises(TimeoutError):
            await matter.mat_url(OUTPUT_URL, flat_rgb(64, 64), 1024)


async def test_a_transient_poll_error_does_not_fail_the_image(settings):
    """A 502 from the API mid-poll is a hiccup; the deadline is the stop."""
    state = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if request.method == "POST":
            return httpx.Response(
                201,
                json={"id": PREDICTION_ID, "status": "starting", "urls": {"get": "https://api.replicate.com/v1/predictions/p"}},
            )
        if "/predictions/" in url:
            state["n"] += 1
            if state["n"] <= 2:
                return httpx.Response(502, text="bad gateway")
            return httpx.Response(200, json={"status": "succeeded", "output": OUTPUT_URL})
        return httpx.Response(200, content=rgba_cutout())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        matter = ReplicateMatter(settings, client)
        alpha = await matter.mat_url(OUTPUT_URL, flat_rgb(64, 64), 1024)
    assert alpha.shape == (64, 64)


async def test_a_create_failure_raises_without_echoing_the_upstream_body(settings):
    transport = build_transport(
        statuses=["starting"], output_bytes=rgba_cutout(), create_status=422
    )
    async with httpx.AsyncClient(transport=transport) as client:
        matter = ReplicateMatter(settings, client)
        with pytest.raises(RuntimeError) as exc:
            await matter.mat_url(OUTPUT_URL, flat_rgb(64, 64), 1024)
    assert "422" in str(exc.value)


# ── output shapes ───────────────────────────────────────────────────────────


async def test_an_rgba_output_uses_its_alpha_channel(settings):
    transport = build_transport(statuses=["succeeded"], output_bytes=rgba_cutout())
    async with httpx.AsyncClient(transport=transport) as client:
        alpha = await ReplicateMatter(settings, client).mat_url(
            OUTPUT_URL, flat_rgb(64, 64), 1024
        )
    assert alpha[32, 32] == pytest.approx(1.0, abs=1e-6)
    assert alpha[2, 2] == pytest.approx(0.0, abs=1e-6)


async def test_a_greyscale_output_is_read_as_the_mask_itself(settings):
    """The same bytes as an RGB image would composite as a BLACK RECTANGLE —
    opaque everywhere, because an RGB decode has no alpha to read."""
    transport = build_transport(statuses=["succeeded"], output_bytes=gray_mask())
    async with httpx.AsyncClient(transport=transport) as client:
        alpha = await ReplicateMatter(settings, client).mat_url(
            OUTPUT_URL, flat_rgb(64, 64), 1024
        )
    assert alpha[32, 32] == pytest.approx(1.0, abs=1e-6)
    assert alpha[2, 2] == pytest.approx(0.0, abs=1e-6)


async def test_no_output_url_is_an_error(settings):
    transport = build_transport(statuses=["succeeded"], output=None, output_bytes=rgba_cutout())
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(RuntimeError):
            await ReplicateMatter(settings, client).mat_url(OUTPUT_URL, flat_rgb(64, 64), 1024)


@pytest.mark.parametrize(
    "output,expected",
    [
        ("https://x/a.png", "https://x/a.png"),
        (["https://x/a.png"], "https://x/a.png"),
        (["", "https://x/b.png"], "https://x/b.png"),
        ({"image": "https://x/c.png"}, "https://x/c.png"),
        ([], None),
        (None, None),
        ({}, None),
    ],
)
def test_output_url_accepts_every_shape_a_birefnet_packaging_uses(output, expected):
    assert _first_url(output) == expected


# ── the request we send ─────────────────────────────────────────────────────


async def test_the_input_key_and_resolution_format_match_the_published_schema(settings):
    """Verified against replicate.com/men1scus/birefnet/api/schema:
       input.image      string, uri, REQUIRED
       input.resolution string, "WxH"  <- a STRING, not an integer
    """
    calls: list[httpx.Request] = []
    transport = build_transport(statuses=["succeeded"], output_bytes=rgba_cutout(), calls=calls)
    async with httpx.AsyncClient(transport=transport) as client:
        await ReplicateMatter(settings, client).mat_url(
            "https://cdn/source.jpg", flat_rgb(64, 64), 2048
        )

    import json as _json

    create = next(c for c in calls if c.method == "POST")
    body = _json.loads(create.content)
    assert body["input"]["image"] == "https://cdn/source.jpg"
    assert body["input"]["resolution"] == "2048x2048"
    assert body["version"] == settings.replicate_version


async def test_a_pinned_version_posts_to_the_generic_predictions_endpoint(settings):
    calls: list[httpx.Request] = []
    transport = build_transport(statuses=["succeeded"], output_bytes=rgba_cutout(), calls=calls)
    async with httpx.AsyncClient(transport=transport) as client:
        await ReplicateMatter(settings, client).mat_url(OUTPUT_URL, flat_rgb(64, 64), 1024)
    create = next(c for c in calls if c.method == "POST")
    assert create.url.path == "/v1/predictions"


async def test_the_model_tag_records_the_pin(settings):
    """'which weights cut this photo' is the question you ask when a batch comes
    out wrong, so mask_model carries the version, not just the model name."""
    async with httpx.AsyncClient(transport=build_transport(statuses=["succeeded"], output_bytes=rgba_cutout())) as client:
        matter = ReplicateMatter(settings, client)
    assert matter.tag == "replicate:men1scus/birefnet@f74986db"


async def test_an_unpinned_backend_says_so_in_the_tag(settings):
    import dataclasses

    unpinned = dataclasses.replace(settings, replicate_version="")
    async with httpx.AsyncClient(transport=build_transport(statuses=["succeeded"], output_bytes=rgba_cutout())) as client:
        matter = ReplicateMatter(unpinned, client)
    assert matter.tag.endswith("@unpinned")


async def test_latest_version_is_reported_but_never_adopted(settings):
    """A service that pins itself to 'whatever is latest at boot' re-pins on
    every restart — the unpinned problem with extra steps."""
    async with httpx.AsyncClient(transport=build_transport(statuses=["succeeded"], output_bytes=rgba_cutout())) as client:
        matter = ReplicateMatter(settings, client)
        latest = await matter.latest_version()
        assert latest == "f" * 64
        assert matter.tag.endswith("@f74986db")  # unchanged


async def test_a_data_uri_is_used_when_the_source_cannot_be_fetched(settings):
    """The private-bucket fallback."""
    calls: list[httpx.Request] = []
    transport = build_transport(statuses=["succeeded"], output_bytes=rgba_cutout(), calls=calls)
    async with httpx.AsyncClient(transport=transport) as client:
        await ReplicateMatter(settings, client).mat_data_uri(
            b"\xff\xd8\xff\xe0jpegbytes", flat_rgb(64, 64), 1024, "image/jpeg"
        )
    import json as _json

    body = _json.loads(next(c for c in calls if c.method == "POST").content)
    assert body["input"]["image"].startswith("data:image/jpeg;base64,")


async def test_mat_with_bytes_is_refused_so_the_url_path_is_not_bypassed(settings):
    async with httpx.AsyncClient(transport=build_transport(statuses=["succeeded"], output_bytes=rgba_cutout())) as client:
        with pytest.raises(NotImplementedError):
            await ReplicateMatter(settings, client).mat(b"x", 1024)


# ── alpha refinement ────────────────────────────────────────────────────────


async def test_a_low_resolution_mask_is_upsampled_to_the_source(settings):
    """The backend contract: alpha comes back at SOURCE resolution, because the
    compositor indexes it against the source pixels."""
    transport = build_transport(statuses=["succeeded"], output_bytes=rgba_cutout(32, 32))
    async with httpx.AsyncClient(transport=transport) as client:
        alpha = await ReplicateMatter(settings, client).mat_url(
            OUTPUT_URL, flat_rgb(256, 192), 1024
        )
    assert alpha.shape == (256, 192)
    assert 0.0 <= alpha.min() <= alpha.max() <= 1.0


def test_refine_alpha_is_a_no_op_when_the_sizes_already_match():
    a = solid_alpha(64, 64, (16, 16, 48, 48))
    out = refine_alpha(a, flat_rgb(64, 64))
    assert np.array_equal(out, a)


def transition_width(x: np.ndarray) -> int:
    """How many pixels of the middle row sit between 'clearly out' and 'clearly
    in'. A mushy edge is wide; a snapped one is narrow."""
    row = x[x.shape[0] // 2]
    return int(((row > 0.1) & (row < 0.9)).sum())


def test_the_guided_filter_snaps_the_alpha_onto_the_luminance_edge():
    """The property the hand-written filter exists for: a blurred mask edge is
    pulled back onto the real edge in the photo, instead of staying mushy."""
    h = w = 128
    guide = np.zeros((h, w), dtype=np.float32)
    guide[:, w // 2 :] = 1.0  # a hard luminance step at x=64

    import cv2

    blurred = cv2.GaussianBlur((guide > 0.5).astype(np.float32), (0, 0), sigmaX=2.0)
    refined = guided_filter(guide, blurred, radius=8, eps=1e-6)

    assert transition_width(refined) < transition_width(blurred)


def test_the_guided_filter_cannot_fix_a_blur_wider_than_its_radius():
    """The documented limit, and the reason `refine_radius` exists. A radius
    that is too small for the transition does not merely fail to help — it is
    measurably no better than doing nothing."""
    h = w = 128
    guide = np.zeros((h, w), dtype=np.float32)
    guide[:, w // 2 :] = 1.0

    import cv2

    blurred = cv2.GaussianBlur((guide > 0.5).astype(np.float32), (0, 0), sigmaX=3.0)
    too_small = guided_filter(guide, blurred, radius=4, eps=1e-6)
    big_enough = guided_filter(guide, blurred, radius=16, eps=1e-6)

    assert transition_width(too_small) >= transition_width(blurred)
    assert transition_width(big_enough) < transition_width(blurred)


@pytest.mark.parametrize(
    "alpha_shape,source_shape,expected",
    [
        ((1024, 1024), (1024, 1024), 8),  # no upsample: the floor
        ((1024, 1024), (2048, 2048), 8),  # 2x: still the floor
        ((1024, 1024), (4032, 3024), 8),  # a 12 MP phone photo, k ~= 3.9
        ((64, 64), (512, 512), 16),  # 8x
        ((64, 64), (4096, 4096), 32),  # 64x: the ceiling
    ],
)
def test_refine_radius_scales_with_the_upsample_factor(alpha_shape, source_shape, expected):
    from app.backends.base import refine_radius

    assert refine_radius(alpha_shape, source_shape) == expected


def test_refine_alpha_beats_plain_bicubic_on_an_upsampled_mask():
    """The real case: a 1024-class mask on a much larger photo."""
    import cv2

    big_h, big_w = 512, 512
    source = np.zeros((big_h, big_w, 3), dtype=np.uint8)
    source[:, big_w // 2 :] = 255  # the true garment edge, at full resolution

    small = np.zeros((64, 64), dtype=np.float32)
    small[:, 32:] = 1.0

    bicubic = np.clip(cv2.resize(small, (big_w, big_h), interpolation=cv2.INTER_CUBIC), 0, 1)
    refined = refine_alpha(small, source)

    assert refined.shape == (big_h, big_w)
    assert transition_width(refined) < transition_width(bicubic)


def test_the_guided_filter_is_deterministic():
    """Composites must be reproducible across machines — the whole reason this
    is not cv2.ximgproc, which is absent from the headless wheel."""
    rng = np.random.default_rng(3)
    guide = rng.random((64, 64)).astype(np.float32)
    src = rng.random((64, 64)).astype(np.float32)
    assert np.array_equal(guided_filter(guide, src), guided_filter(guide, src))

"""The presetHash contract.

THESE VECTORS ARE THE SAME ONES IN CONTRACT.md §4, and the TypeScript side
asserts the identical strings. If a change here makes a vector move, it is not a
test to update — it is a breaking change that invalidates every stored composite
in every workspace and must be shipped as a new preset, not as a new hash for an
old one.

THE VECTORS MOVED ONCE, ON PURPOSE (Sept 20 2026). Adding `backdrop` to the
canonical form retired `7abc910f` (defaults) and `c7e0869c` (vector 2). That was
safe for exactly one reason: **nothing had ever been processed under them.** The
first production run failed all three of its photos on Replicate's billing gate,
so no composite anywhere carries an old hash and there is nothing to migrate. Had
a single catalogue been matted first, the backdrop field would have had to ship as
a second preset instead.
"""

from __future__ import annotations

import pytest

from app.preset import BackgroundPreset, PresetError

# ── The fixed vectors ───────────────────────────────────────────────────────

VECTOR_DEFAULT_JSON = (
    '{"anchor":"center","backdrop":"","canvas":2048,"color":"#FFFFFF",'
    '"padding":0.1,"quality":90,"shadow":false}'
)
VECTOR_DEFAULT_HASH = "6300e6dc"

VECTOR_B_INPUT = {
    "canvas": 1536,
    "color": "#f4f4f4",
    "padding": 0.08,
    "anchor": "top",
    "shadow": True,
    "quality": 85,
}
VECTOR_B_JSON = (
    '{"anchor":"top","backdrop":"","canvas":1536,"color":"#F4F4F4",'
    '"padding":0.08,"quality":85,"shadow":true}'
)
VECTOR_B_HASH = "a4c629a4"

BACKDROP_PATH = "u1/backdrops/1700000000000-linen.jpg"
VECTOR_BACKDROP_INPUT = {"backdrop": {"storagePath": BACKDROP_PATH, "fit": "cover"}}
VECTOR_BACKDROP_JSON = (
    '{"anchor":"center","backdrop":"u1/backdrops/1700000000000-linen.jpg","canvas":2048,'
    '"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}'
)
VECTOR_BACKDROP_HASH = "6218c54a"

RETIRED_HASHES = ("7abc910f", "c7e0869c")


def test_vector_1_default_preset():
    p = BackgroundPreset()
    assert p.canonical_json() == VECTOR_DEFAULT_JSON
    assert p.hash == VECTOR_DEFAULT_HASH


def test_vector_1_defaults_are_applied_from_an_empty_object():
    """An app that sends `{}` must land on exactly the same hash as one that
    sends nothing — otherwise "the default preset" means two different looks."""
    assert BackgroundPreset.parse({}).hash == VECTOR_DEFAULT_HASH
    assert BackgroundPreset.parse(None).hash == VECTOR_DEFAULT_HASH


def test_vector_2_every_field_non_default():
    p = BackgroundPreset.parse(VECTOR_B_INPUT)
    assert p.canonical_json() == VECTOR_B_JSON
    assert p.hash == VECTOR_B_HASH


def test_vector_3_a_photo_backdrop():
    """The backdrop is hashed as its BARE PATH, so a new backdrop is a new look
    and every composite made under the old one is correctly stale."""
    p = BackgroundPreset.parse(VECTOR_BACKDROP_INPUT)
    assert p.canonical_json() == VECTOR_BACKDROP_JSON
    assert p.hash == VECTOR_BACKDROP_HASH


def test_the_retired_hashes_are_gone_from_every_vector():
    """A guard against re-deriving the pre-backdrop canonical form by accident —
    those two strings must never be produced by this code again."""
    produced = {
        BackgroundPreset().hash,
        BackgroundPreset.parse(VECTOR_B_INPUT).hash,
        BackgroundPreset.parse(VECTOR_BACKDROP_INPUT).hash,
    }
    assert produced.isdisjoint(RETIRED_HASHES)


def test_vector_4_padding_0_1_and_0_100_hash_identically():
    """The float-formatting rule, which is the whole reason padding is not
    serialised with the language's repr."""
    a = BackgroundPreset.parse({"padding": 0.1})
    b = BackgroundPreset.parse({"padding": 0.100})
    assert a.canonical_json() == b.canonical_json()
    assert a.hash == b.hash == VECTOR_DEFAULT_HASH


@pytest.mark.parametrize("padding,expected", [(0, "0"), (0.0, "0"), (0.08, "0.08"), (0.4, "0.4")])
def test_padding_serialisation_strips_trailing_zeros(padding, expected):
    p = BackgroundPreset.parse({"padding": padding})
    assert f'"padding":{expected},' in p.canonical_json()


def test_float_noise_below_three_decimals_collapses():
    """A slider that emits 0.10000000000000003 must not mint a second hash for a
    look nobody can distinguish."""
    assert BackgroundPreset.parse({"padding": 0.10000000000000003}).hash == VECTOR_DEFAULT_HASH
    assert BackgroundPreset.parse({"padding": 0.0999999}).hash == VECTOR_DEFAULT_HASH


def test_colour_case_does_not_change_the_hash():
    assert BackgroundPreset.parse({"color": "#ffffff"}).hash == VECTOR_DEFAULT_HASH
    assert BackgroundPreset.parse({"color": "#FfFfFf"}).hash == VECTOR_DEFAULT_HASH


def test_id_and_name_are_not_hashed():
    """Renaming a preset must not invalidate every composite made with it."""
    a = BackgroundPreset.parse({"id": "white-2048"})
    b = BackgroundPreset.parse({"id": "default-white", "name": "Default white"})
    assert a.hash == b.hash == VECTOR_DEFAULT_HASH


def test_hash_is_eight_lowercase_hex():
    for preset in (BackgroundPreset(), BackgroundPreset.parse(VECTOR_B_INPUT)):
        assert len(preset.hash) == 8
        assert all(c in "0123456789abcdef" for c in preset.hash)


def test_every_visual_field_changes_the_hash():
    """No field may be silently ignored — a preset difference the hash cannot
    see is a stale composite that never refreshes."""
    base = BackgroundPreset()
    variants = [
        {"canvas": 1536},
        {"color": "#000000"},
        {"padding": 0.2},
        {"anchor": "top"},
        {"shadow": True},
        {"quality": 85},
        {"backdrop": BACKDROP_PATH},
    ]
    hashes = {BackgroundPreset.parse(v).hash for v in variants}
    assert base.hash not in hashes
    assert len(hashes) == len(variants)


# ── Validation is loud, not clamping ────────────────────────────────────────


@pytest.mark.parametrize(
    "raw",
    [
        {"padding": 0.9},  # out of range, and a misunderstood unit
        {"padding": -0.1},
        {"canvas": 99},
        {"canvas": 8192},
        {"canvas": 2048.5},
        {"canvas": True},  # bool is an int in Python; it is not a canvas size
        {"color": "white"},
        {"color": "#FFF"},
        {"color": "#GGGGGG"},
        {"anchor": "bottom"},
        {"shadow": "yes"},
        {"quality": 100},
        {"quality": 10},
        {"id": ""},
        [],
        "default",
    ],
)
def test_invalid_presets_raise(raw):
    with pytest.raises(PresetError):
        BackgroundPreset.parse(raw)


def test_rgb_unpacks_the_colour():
    assert BackgroundPreset.parse({"color": "#F4F4F4"}).rgb() == (244, 244, 244)
    assert BackgroundPreset.parse({"color": "#000000"}).rgb() == (0, 0, 0)


def test_to_dict_reports_the_hash_for_the_client():
    d = BackgroundPreset().to_dict()
    assert d["presetHash"] == VECTOR_DEFAULT_HASH
    assert d["color"] == "#FFFFFF"


# ── The backdrop field ──────────────────────────────────────────────────────


def test_no_backdrop_is_the_empty_string_in_the_canonical_form():
    """Not an omitted key: a key that appears only sometimes means the TypeScript
    and Python builders have to agree about WHEN, which is a second contract."""
    assert '"backdrop":"",' in BackgroundPreset().canonical_json()
    assert BackgroundPreset.parse({"backdrop": None}).hash == VECTOR_DEFAULT_HASH


def test_a_bare_path_string_is_accepted_as_a_backdrop():
    """The canonical form writes the backdrop as a bare string, so a caller that
    round-trips its own canonical form must not get a 422 (CONTRACT.md §4)."""
    assert BackgroundPreset.parse({"backdrop": BACKDROP_PATH}).hash == VECTOR_BACKDROP_HASH
    assert BackgroundPreset.parse({"backdrop": ""}).hash == VECTOR_DEFAULT_HASH


def test_fit_defaults_to_cover_and_nothing_else_is_legal():
    assert BackgroundPreset.parse({"backdrop": {"storagePath": BACKDROP_PATH}}).backdrop.fit == "cover"
    with pytest.raises(PresetError):
        BackgroundPreset.parse({"backdrop": {"storagePath": BACKDROP_PATH, "fit": "contain"}})


def test_fit_is_not_hashed_because_cover_is_its_only_value():
    """Documented in preset.py: the day a second fit exists it MUST enter the
    canonical form, and that is a breaking change. Until then, hashing it would
    only risk the two languages spelling a default differently."""
    explicit = BackgroundPreset.parse({"backdrop": {"storagePath": BACKDROP_PATH, "fit": "cover"}})
    implied = BackgroundPreset.parse({"backdrop": {"storagePath": BACKDROP_PATH}})
    assert explicit.hash == implied.hash == VECTOR_BACKDROP_HASH


def test_two_backdrops_are_two_looks():
    a = BackgroundPreset.parse({"backdrop": "u1/backdrops/1-linen.jpg"})
    b = BackgroundPreset.parse({"backdrop": "u1/backdrops/2-concrete.jpg"})
    assert a.hash != b.hash
    assert BackgroundPreset().hash not in (a.hash, b.hash)


def test_a_backdrop_does_not_change_the_colour_or_the_geometry():
    """It replaces the FILL, and nothing else — the same subject placement, which
    is what makes a backdrop switch look like the same catalogue."""
    p = BackgroundPreset.parse({"backdrop": BACKDROP_PATH})
    assert p.color == "#FFFFFF"
    assert (p.canvas, p.padding, p.anchor) == (2048, 0.1, "center")


@pytest.mark.parametrize(
    "path",
    [
        "/absolute/linen.jpg",              # would leave the bucket-relative space
        "u1/../../etc/passwd",              # traversal
        "https://evil.example/linen.jpg",   # a scheme is not a storage path
        "u1\\backdrops\\linen.jpg",         # a windows separator
        "u1/backdrops/linen.jpg?x=1",       # would rewrite the URL it is pasted into
        "u1/backdrops/linen.jpg#f",
        "u1/backdrops/li\nnen.jpg",         # a control character, headed for a log line
        "u1/backdrops/" + "a" * 400,        # absurd length
        "   ",
    ],
)
def test_an_unsafe_backdrop_path_is_refused(path):
    with pytest.raises(PresetError):
        BackgroundPreset.parse({"backdrop": {"storagePath": path}})


@pytest.mark.parametrize("raw", [{"backdrop": 7}, {"backdrop": []}, {"backdrop": {"fit": "cover"}}])
def test_a_malformed_backdrop_is_refused(raw):
    with pytest.raises(PresetError):
        BackgroundPreset.parse(raw)


def test_a_backdrop_path_is_trimmed_on_the_way_in():
    """Same reasoning as brand_aliases.heard in the app: a value that is indexed
    (here: hashed) in one form and looked up in another is unreachable."""
    p = BackgroundPreset.parse({"backdrop": {"storagePath": f"  {BACKDROP_PATH}  "}})
    assert p.backdrop.storage_path == BACKDROP_PATH
    assert p.hash == VECTOR_BACKDROP_HASH


def test_to_dict_round_trips_the_backdrop_for_the_client():
    d = BackgroundPreset.parse(VECTOR_BACKDROP_INPUT).to_dict()
    assert d["backdrop"] == {"storagePath": BACKDROP_PATH, "fit": "cover"}
    assert d["presetHash"] == VECTOR_BACKDROP_HASH
    assert BackgroundPreset().to_dict()["backdrop"] is None

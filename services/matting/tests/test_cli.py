"""The offline CLI, in the parts that can be exercised without a model.

The CLI exists because the founder's work is not allowed to stop because the
service is down, a card expired, or Replicate is having an afternoon — which is
not hypothetical: the first production run died on a billing gate. So `--backdrop`
has to work here too, and it has to refuse rather than quietly render the wrong
thing.

No test here builds a backend (the `local` one wants ~2.5 GB of torch) or touches
the network.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from app.cli import _load_backdrop, main
from app.compose import cover_crop
from app.preset import BackgroundPreset
from tests.conftest import gradient_rgb


def write_image(path, rgb: np.ndarray) -> str:
    buf = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(buf, format="JPEG", quality=95)
    path.write_bytes(buf.getvalue())
    return str(path)


def test_load_backdrop_cover_crops_to_the_preset_canvas(tmp_path):
    src = gradient_rgb(300, 500)
    file = write_image(tmp_path / "linen.jpg", src)
    preset = BackgroundPreset.parse({"canvas": 256})

    updated, backdrop = _load_backdrop(file, preset)

    assert backdrop.shape == (256, 256, 3)
    # The same cover_crop the service applies, on the same decoded bytes.
    from app.compose import decode_image_rgb

    assert np.array_equal(backdrop, cover_crop(decode_image_rgb((tmp_path / "linen.jpg").read_bytes()), 256))
    assert updated.backdrop is not None


def test_load_backdrop_changes_the_hash_so_two_backdrops_write_two_files(tmp_path):
    """The output filename is `bg-<hash>-<stem>.jpg`. If the backdrop did not reach
    the hash, rendering the same photo on linen and on concrete would overwrite
    one file with the other and a comparison would be impossible."""
    preset = BackgroundPreset.parse({"canvas": 256})
    linen, _ = _load_backdrop(write_image(tmp_path / "linen.jpg", gradient_rgb(200, 200)), preset)
    stone, _ = _load_backdrop(write_image(tmp_path / "stone.jpg", gradient_rgb(200, 200)), preset)

    assert linen.hash != stone.hash != preset.hash
    assert linen.backdrop.storage_path == "linen.jpg"


def test_the_cli_accepts_a_backdrop_flag(tmp_path, capsys):
    """Argparse acceptance plus the load, without needing a backend: an empty
    input directory returns 1 AFTER the backdrop has been prepared and reported."""
    photos = tmp_path / "photos"
    photos.mkdir()
    backdrop = write_image(tmp_path / "linen.jpg", gradient_rgb(400, 300))

    code = main(
        ["--backend", "local", "--in", str(photos), "--out", str(tmp_path / "out"), "--backdrop", backdrop]
    )
    out = capsys.readouterr()

    assert code == 1  # "no images in …"
    assert "cover-cropped to 2048x2048" in out.out
    assert '"backdrop":"linen.jpg"' in out.out


def test_a_preset_naming_a_bucket_backdrop_is_refused_offline(tmp_path, capsys):
    """There is no Supabase here, so the path cannot be fetched. Rendering on the
    flat colour instead would write a file named after a backdrop hash that does
    not describe it — a file that lies about what it is."""
    import json

    photos = tmp_path / "photos"
    photos.mkdir()
    preset_file = tmp_path / "preset.json"
    preset_file.write_text(json.dumps({"backdrop": "u1/backdrops/1-linen.jpg"}))

    code = main(
        ["--backend", "local", "--preset", str(preset_file), "--in", str(photos), "--out", str(tmp_path / "out")]
    )
    err = capsys.readouterr().err

    assert code == 1
    assert "pass --backdrop <file>" in err

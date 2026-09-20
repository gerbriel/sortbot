"""The presetHash contract.

THESE THREE VECTORS ARE THE SAME THREE IN CONTRACT.md §4, and the TypeScript
side asserts the identical strings. If a change here makes a vector move, it is
not a test to update — it is a breaking change that invalidates every stored
composite in every workspace and must be shipped as a new preset, not as a new
hash for an old one.
"""

from __future__ import annotations

import pytest

from app.preset import BackgroundPreset, PresetError

# ── The fixed vectors ───────────────────────────────────────────────────────

VECTOR_DEFAULT_JSON = (
    '{"anchor":"center","canvas":2048,"color":"#FFFFFF","padding":0.1,"quality":90,"shadow":false}'
)
VECTOR_DEFAULT_HASH = "7abc910f"

VECTOR_B_INPUT = {
    "canvas": 1536,
    "color": "#f4f4f4",
    "padding": 0.08,
    "anchor": "top",
    "shadow": True,
    "quality": 85,
}
VECTOR_B_JSON = (
    '{"anchor":"top","canvas":1536,"color":"#F4F4F4","padding":0.08,"quality":85,"shadow":true}'
)
VECTOR_B_HASH = "c7e0869c"


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


def test_vector_3_padding_0_1_and_0_100_hash_identically():
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

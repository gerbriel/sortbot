"""The idempotency rule and the derived-file naming.

`already_done` decides what POST /v1/jobs reports as `skipped`, so the app
agent's "regenerate backgrounds" button depends on it being exactly what
CONTRACT.md §5 says. Getting it wrong is either a no-op button or a bill.
"""

from __future__ import annotations

import pytest

from app.auth import ImageRow
from app.pipeline import already_done
from app.storage import derived_paths

TAG = "replicate:men1scus/birefnet@f74986db"
HASH = "6300e6dc"


def row(**over) -> ImageRow:
    base = {
        "id": "img-1",
        "product_id": "prod-1",
        "storage_path": "user/prod/photo.jpg",
        "image_url": "https://cdn/photo.jpg",
        "org_id": "org-1",
        "cutout_storage_path": "user/prod/cut-x-1.webp",
        "composite_storage_path": "user/prod/bg-6300e6dc-1.jpg",
        "bg_preset": HASH,
        "mask_status": "auto",
        "mask_model": TAG,
    }
    base.update(over)
    return ImageRow(**base)


def test_a_row_matted_with_this_model_and_preset_is_skipped():
    assert already_done(row(), TAG, HASH) is True


def test_a_new_preset_is_not_skipped():
    """A new look needs a new composite — from the SAME alpha, so it is free."""
    assert already_done(row(), TAG, "a4c629a4") is False


def test_a_new_model_is_not_skipped():
    """Re-pinning to newer weights means the catalog should be re-cut."""
    assert already_done(row(), "replicate:men1scus/birefnet@aaaaaaaa", HASH) is False


def test_a_never_processed_row_is_not_skipped():
    assert already_done(row(cutout_storage_path=None, composite_storage_path=None, bg_preset=None, mask_model=None, mask_status=None), TAG, HASH) is False


def test_a_row_with_an_alpha_but_no_composite_is_not_skipped():
    """A half-finished image (crash between step 3 and step 4) must be picked
    up again rather than reported as done."""
    assert already_done(row(composite_storage_path=None), TAG, HASH) is False


def test_a_failed_row_is_always_retried():
    """Pressing the button again IS the retry — that is the whole point."""
    assert already_done(row(mask_status="failed"), TAG, HASH) is False


@pytest.mark.parametrize("status", ["auto", "review", "approved", "original"])
def test_a_human_decision_is_never_re_matted_by_a_plain_run(status):
    """THE IMPORTANT ONE. 'approved' and 'original' are somebody's judgement;
    a background refresh that quietly re-cut them would throw that away and the
    review queue would refill with work that had already been done."""
    assert already_done(row(mask_status=status), TAG, HASH) is True


def test_a_queued_row_is_re_accepted_because_nobody_is_working_on_it():
    """THE OTHER IMPORTANT ONE, and it cost a production run to learn.

    'queued' is written BEFORE any work starts, so a machine that dies mid-batch
    leaves its remaining photos queued with nothing behind them — and on Fly's
    trial every machine is stopped after five minutes, so that is the normal case.
    The trap is that mark_queued touches only mask_status: a re-queued row still
    carries the PREVIOUS run's model and preset, so the idempotency key matches and
    the row would be skipped forever, permanently 'in flight' with no process.

    The rows this process really is holding are excluded in main.py, from the one
    place that knows: JobRegistry.inflight_ids().
    """
    assert already_done(row(mask_status="queued"), TAG, HASH) is False


# ── derived paths ───────────────────────────────────────────────────────────


def test_derived_files_land_beside_the_source():
    cut, comp = derived_paths("user-id/product-id/1758-abc.jpg", TAG, HASH)
    assert cut.startswith("user-id/product-id/cut-")
    assert comp.startswith("user-id/product-id/bg-")
    assert cut.endswith(".webp")
    assert comp.endswith(".jpg")


def test_the_source_path_is_never_reused():
    """AGENTS.md §18 #35 — images are immutable per storage_path, and the
    Service Worker caches them for seven days on that promise."""
    source = "user-id/product-id/1758-abc.jpg"
    cut, comp = derived_paths(source, TAG, HASH)
    assert cut != source
    assert comp != source


def test_the_model_tag_is_flattened_into_a_legal_filename():
    """'replicate:men1scus/birefnet@f74986db' is a fine tag and a terrible path
    segment — a '/' in it would silently create a directory."""
    cut, _ = derived_paths("u/p/x.jpg", TAG, HASH)
    leaf = cut.rsplit("/", 1)[-1]
    assert "/" not in leaf
    assert ":" not in leaf
    assert "@" not in leaf
    assert leaf.startswith("cut-replicate_men1scus_birefnet_f74986db-")


def test_the_composite_name_carries_the_preset_hash():
    """So that "which preset made this file" is answerable from the bucket
    alone, without the database."""
    _, comp = derived_paths("u/p/x.jpg", TAG, HASH)
    assert comp.rsplit("/", 1)[-1].startswith(f"bg-{HASH}-")


def test_two_runs_produce_different_paths():
    """The timestamp is what makes a concurrent re-run safe: two files and two
    UPDATEs, rather than one overwriting bytes the other is about to link."""
    import time

    a = derived_paths("u/p/x.jpg", TAG, HASH)
    time.sleep(0.002)
    b = derived_paths("u/p/x.jpg", TAG, HASH)
    assert a != b


def test_a_source_at_the_bucket_root_still_works():
    cut, comp = derived_paths("photo.jpg", TAG, HASH)
    assert "/" not in cut and "/" not in comp


# ── what a submit takes on ──────────────────────────────────────────────────


def rows(*specs) -> list:
    out = []
    for i, over in enumerate(specs, start=1):
        out.append(row(id=f"img-{i}", **over))
    return out


def test_accepted_rows_skips_what_is_already_done():
    from app.pipeline import accepted_rows

    batch = rows({}, {"bg_preset": "deadbeef"})
    taken = accepted_rows(batch, matter_tag=TAG, preset_hash=HASH, force=False)
    assert [r.id for r in taken] == ["img-2"]


def test_force_takes_a_done_row():
    from app.pipeline import accepted_rows

    batch = rows({}, {})
    taken = accepted_rows(batch, matter_tag=TAG, preset_hash=HASH, force=True)
    assert len(taken) == 2


def test_a_row_this_process_is_holding_is_skipped_even_under_force():
    """MONEY, not correctness. The per-org lock means a duplicate job runs AFTER
    the first, so nothing is corrupted — but its accepted list was decided before
    the first job wrote a row, so `already_done` cannot catch it retrospectively
    and every photo is matted (and billed) twice. `force` means "ignore what the
    row says", never "do it twice"."""
    from app.pipeline import accepted_rows

    batch = rows({"mask_status": "queued"}, {"mask_status": "queued"})
    taken = accepted_rows(
        batch, matter_tag=TAG, preset_hash=HASH, force=True, inflight={"img-1"}
    )
    assert [r.id for r in taken] == ["img-2"]


def test_an_orphaned_queued_row_is_taken_when_nobody_is_holding_it():
    """The Fly-trial case: the machine that queued these went away. Note the rows
    carry the CURRENT model and preset, which is exactly why the status has to be
    part of the decision — the idempotency key alone would skip them forever."""
    from app.pipeline import accepted_rows

    batch = rows({"mask_status": "queued"}, {"mask_status": "queued"})
    taken = accepted_rows(batch, matter_tag=TAG, preset_hash=HASH, force=False, inflight=frozenset())
    assert [r.id for r in taken] == ["img-1", "img-2"]

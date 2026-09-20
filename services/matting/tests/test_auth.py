"""The security boundary.

The service writes with the service role, which bypasses RLS. These tests are
the only automated statement of what stops that from being "any caller may
matte any photo in the product", so they are written against the CASES rather
than against the implementation: a refactor may move the code, but every one of
these must keep failing closed.

Everything is driven through httpx.MockTransport. Nothing reaches the network.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.auth import AuthError, ForbiddenError, authorize, bearer_token, resolve_uid

OWNER = "11111111-1111-1111-1111-111111111111"
OUTSIDER = "33333333-3333-3333-3333-333333333333"
ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
IMG_1 = "dddddddd-dddd-dddd-dddd-ddddddddddd1"
IMG_2 = "dddddddd-dddd-dddd-dddd-ddddddddddd2"


def image_row(image_id: str, org_id: str, **over) -> dict:
    row = {
        "id": image_id,
        "product_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "storage_path": f"user/product/{image_id}.jpg",
        "image_url": f"https://cdn/{image_id}.jpg",
        "cutout_storage_path": None,
        "composite_storage_path": None,
        "bg_preset": None,
        "mask_status": None,
        "mask_model": None,
        "products": {"org_id": org_id},
    }
    row.update(over)
    return row


def make_client(
    *,
    user: dict | None = None,
    user_status: int = 200,
    memberships: list[dict] | None = None,
    rows: list[dict] | None = None,
    rows_status: int = 200,
    calls: list[httpx.Request] | None = None,
) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request)
        path = request.url.path
        if path.endswith("/auth/v1/user"):
            return httpx.Response(user_status, json=user if user is not None else {})
        if path.endswith("/rest/v1/org_members"):
            return httpx.Response(200, json=memberships or [])
        if path.endswith("/rest/v1/product_images"):
            return httpx.Response(rows_status, json=rows or [])
        raise AssertionError(f"unexpected request: {request.url}")

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ── bearer_token ────────────────────────────────────────────────────────────


def test_missing_authorization_header_is_401():
    with pytest.raises(AuthError):
        bearer_token(None)
    with pytest.raises(AuthError):
        bearer_token("")
    with pytest.raises(AuthError):
        bearer_token("Bearer ")


@pytest.mark.parametrize("header", ["Bearer abc.def.ghi", "bearer abc.def.ghi", "abc.def.ghi"])
def test_a_token_is_extracted_however_it_is_spelled(header):
    assert bearer_token(header) == "abc.def.ghi"


# ── step 1: who is calling ──────────────────────────────────────────────────


async def test_401_when_supabase_rejects_the_token(settings):
    async with make_client(user_status=401) as client:
        with pytest.raises(AuthError):
            await resolve_uid(client, settings, "expired")


async def test_401_for_the_anon_key_which_is_a_valid_project_jwt(settings):
    """THE TRAP AUDIT 05 FOUND IN THE EDGE FUNCTIONS (AGENTS.md §9).

    The anon key is a correctly signed project JWT and is printed in the browser
    bundle, so any check of the form "is this a well-formed project token"
    admits the entire internet. /auth/v1/user answers 200 with a body that
    contains NO user id for it — which must be a refusal, not a pass.
    """
    async with make_client(user_status=200, user={"aud": "authenticated", "role": "anon"}) as client:
        with pytest.raises(AuthError):
            await resolve_uid(client, settings, "the-anon-key")


async def test_401_when_the_verification_call_itself_fails(settings):
    """'Could not check' must never mean 'allowed'."""

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("network down")

    async with httpx.AsyncClient(transport=httpx.MockTransport(boom)) as client:
        with pytest.raises(AuthError):
            await resolve_uid(client, settings, "token")


async def test_a_real_user_resolves(settings):
    async with make_client(user={"id": OWNER}) as client:
        assert await resolve_uid(client, settings, "good") == OWNER


async def test_the_token_is_never_decoded_locally(settings):
    """It is sent to Supabase with the ANON key as apikey — never the service
    role, whose only job here is the database reads."""
    calls: list[httpx.Request] = []
    async with make_client(user={"id": OWNER}, calls=calls) as client:
        await resolve_uid(client, settings, "good")
    req = calls[0]
    assert req.url.path.endswith("/auth/v1/user")
    assert req.headers["apikey"] == settings.anon_key
    assert req.headers["apikey"] != settings.service_role_key
    assert req.headers["Authorization"] == "Bearer good"


# ── step 2: what may they touch ─────────────────────────────────────────────


async def test_the_happy_path_returns_the_uid_org_and_rows(settings):
    async with make_client(
        user={"id": OWNER},
        memberships=[{"org_id": ORG_A}],
        rows=[image_row(IMG_1, ORG_A), image_row(IMG_2, ORG_A)],
    ) as client:
        uid, org_id, rows = await authorize(client, settings, "good", [IMG_1, IMG_2])
    assert uid == OWNER
    assert org_id == ORG_A
    assert {r.id for r in rows} == {IMG_1, IMG_2}
    assert rows[0].storage_path


async def test_403_for_a_row_in_another_workspace(settings):
    """The core case. The service role can read it; the caller may not touch it."""
    async with make_client(
        user={"id": OUTSIDER},
        memberships=[{"org_id": ORG_B}],
        rows=[image_row(IMG_1, ORG_A)],
    ) as client:
        with pytest.raises(ForbiddenError):
            await authorize(client, settings, "good", [IMG_1])


async def test_403_when_one_id_of_many_is_foreign(settings):
    """A partial success would be indistinguishable from a success, so a bug
    that sends the wrong ids would look like 'matting sometimes skips photos'."""
    async with make_client(
        user={"id": OWNER},
        memberships=[{"org_id": ORG_A}],
        rows=[image_row(IMG_1, ORG_A), image_row(IMG_2, ORG_B)],
    ) as client:
        with pytest.raises(ForbiddenError):
            await authorize(client, settings, "good", [IMG_1, IMG_2])


async def test_403_for_an_id_that_does_not_exist(settings):
    """Not 404 — answering 404 for 'absent' and 403 for 'not yours' is an
    existence oracle over an otherwise opaque uuid space."""
    async with make_client(
        user={"id": OWNER}, memberships=[{"org_id": ORG_A}], rows=[]
    ) as client:
        with pytest.raises(ForbiddenError):
            await authorize(client, settings, "good", [IMG_1])


async def test_403_for_a_signed_in_account_with_no_workspace(settings):
    """The waitlist case: a real user with no photos of their own."""
    async with make_client(user={"id": OUTSIDER}, memberships=[], rows=[]) as client:
        with pytest.raises(ForbiddenError):
            await authorize(client, settings, "good", [IMG_1])


async def test_403_for_an_empty_id_list(settings):
    async with make_client(user={"id": OWNER}, memberships=[{"org_id": ORG_A}]) as client:
        with pytest.raises(ForbiddenError):
            await authorize(client, settings, "good", [])


async def test_403_when_a_job_spans_two_workspaces_the_caller_belongs_to(settings):
    """Even with permission on both: a job is serialised per org, so a job
    spanning two has no single queue to sit in."""
    async with make_client(
        user={"id": OWNER},
        memberships=[{"org_id": ORG_A}, {"org_id": ORG_B}],
        rows=[image_row(IMG_1, ORG_A), image_row(IMG_2, ORG_B)],
    ) as client:
        with pytest.raises(ForbiddenError):
            await authorize(client, settings, "good", [IMG_1, IMG_2])


async def test_a_row_with_a_null_org_is_refused(settings):
    """An untagged row cannot be proven to belong to anybody."""
    async with make_client(
        user={"id": OWNER},
        memberships=[{"org_id": ORG_A}],
        rows=[image_row(IMG_1, ORG_A, products=None)],
    ) as client:
        with pytest.raises(ForbiddenError):
            await authorize(client, settings, "good", [IMG_1])


async def test_postgrest_embedded_rows_parse_as_object_or_single_element_array(settings):
    """PostgREST renders a to-one embed either way depending on the relationship
    shape. Betting on one makes org_id None, which reads as a mystery 403."""
    for embed in ({"org_id": ORG_A}, [{"org_id": ORG_A}]):
        async with make_client(
            user={"id": OWNER},
            memberships=[{"org_id": ORG_A}],
            rows=[image_row(IMG_1, ORG_A, products=embed)],
        ) as client:
            _, org_id, _ = await authorize(client, settings, "good", [IMG_1])
        assert org_id == ORG_A


async def test_the_row_read_uses_the_service_role_and_projects_its_columns(settings):
    """select('*') would put the workspace's whole row shape into any log line
    or exception that carries the response."""
    calls: list[httpx.Request] = []
    async with make_client(
        user={"id": OWNER},
        memberships=[{"org_id": ORG_A}],
        rows=[image_row(IMG_1, ORG_A)],
        calls=calls,
    ) as client:
        await authorize(client, settings, "good", [IMG_1])

    rows_req = next(r for r in calls if r.url.path.endswith("/rest/v1/product_images"))
    assert rows_req.headers["apikey"] == settings.service_role_key
    select = rows_req.url.params["select"]
    assert "*" not in select
    assert "products(org_id)" in select
    assert "storage_path" in select


async def test_a_failed_membership_lookup_is_a_401_not_an_empty_allowlist(settings):
    """An empty set of orgs from a BROKEN lookup and from a real waitlist user
    look identical; treating the broken one as 'no permissions' is right, but it
    must not be reported as the user's fault or retried into a 403 loop."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/auth/v1/user"):
            return httpx.Response(200, json={"id": OWNER})
        if request.url.path.endswith("/rest/v1/org_members"):
            return httpx.Response(500, text="boom")
        return httpx.Response(200, json=[])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(AuthError):
            await authorize(client, settings, "good", [IMG_1])


async def test_ids_are_chunked_at_one_hundred(settings):
    """PostgREST answers a too-long URL with a 400/414. The app chunks at 100
    (ID_CHUNK); matching it means the two sides fail at the same size."""
    ids = [f"{i:08d}-0000-0000-0000-000000000000" for i in range(250)]
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path.endswith("/auth/v1/user"):
            return httpx.Response(200, json={"id": OWNER})
        if request.url.path.endswith("/rest/v1/org_members"):
            return httpx.Response(200, json=[{"org_id": ORG_A}])
        raw = request.url.params["id"]
        chunk = raw[len("in.(") : -1].split(",")
        return httpx.Response(200, json=[image_row(c.strip('"'), ORG_A) for c in chunk])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        _, _, rows = await authorize(client, settings, "good", ids)

    image_calls = [c for c in calls if c.url.path.endswith("/rest/v1/product_images")]
    assert len(image_calls) == 3  # 100 + 100 + 50
    assert len(rows) == 250


async def test_uuids_in_the_in_filter_are_quoted(settings):
    """PostgREST's in.() grammar treats , ( ) . as syntax; quoting the values is
    what stops a crafted id from re-writing the filter."""
    calls: list[httpx.Request] = []
    async with make_client(
        user={"id": OWNER},
        memberships=[{"org_id": ORG_A}],
        rows=[image_row(IMG_1, ORG_A)],
        calls=calls,
    ) as client:
        await authorize(client, settings, "good", [IMG_1])
    req = next(c for c in calls if c.url.path.endswith("/rest/v1/product_images"))
    assert req.url.params["id"] == f'in.("{IMG_1}")'


def test_no_secret_is_ever_serialisable_into_a_response(settings):
    """A belt-and-braces check that the settings object is not something a
    handler could return by accident."""
    with pytest.raises(TypeError):
        json.dumps(settings)

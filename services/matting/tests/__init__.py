"""Marks tests/ as a package.

Without it, `from tests.conftest import ...` only resolves when pytest is
invoked from inside services/matting — which is not how CI invokes it
(`pytest services/matting` from the repo root). With it, pytest inserts
services/matting on sys.path instead of services/matting/tests, and the import
works from any working directory.

setuptools excludes this package from the wheel (`include = ["app*"]`), so it
never ships.
"""

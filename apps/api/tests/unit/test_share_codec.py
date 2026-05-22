# apps/api/tests/unit/test_share_codec.py
# docs: 04-domain-model.md#submission · 07-api-contracts.md#save
from app.services.share_codec import canonical_json, content_hash, short_hash
from tests.conftest import good_level


def test_hashes_are_deterministic_and_sized() -> None:
    level = good_level()
    assert short_hash(level) == short_hash(level)
    assert len(short_hash(level)) == 6
    assert len(content_hash(level)) == 12


def test_canonical_json_is_key_sorted() -> None:
    cj = canonical_json(good_level())
    # schemaVersion sorts before spawn/vibe; goal before platforms, etc.
    assert cj.index('"goal"') < cj.index('"platforms"') < cj.index('"vibe"')

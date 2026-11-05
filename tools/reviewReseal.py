"""Explicit offline maintenance; never imported by application or build preparation."""

import argparse
import hashlib
import json
import os
from pathlib import Path

Protected = {
    "evaluation/modules/module1/claims.json": "b1b28cb6522e9a18654e978ea5b669f2f107b2b858f920d907634a99577ff187",
    "evaluation/modules/module2/claims.json": "a42079d0122c9cdb98a125e6783456c40be632eda93f5ae4e911359d1f6579c7",
    "evaluation/integrity.json": "f0a8ac479f6d2a7c3f3340aac8bc936889a0f9bfdf7db784835531595632d634",
    "shared/reviewedVariants.json": "4796b76272a0596c97f774a8013416f2503562cbf375d6f15e1a7581c618378b",
    "shared/responsePresentation.json": "1532cc50cdf77e160388cd32481a51f21fef5c615bdcd125906c6ab20095e6ae",
    "shared/summaryPresentation.json": "ed76522ef37bb49faa89cfcea5ca9e327bf34439e785e2658ce289abc5c10765",
}
Targets = ("evaluation/review.json", "backend/competition/evaluationSeal.py", "netlify/evaluation/reviewSeal.ts")
Journal = ".testReviewResealRecovery.json"


class ResealError(ValueError):
    """Bounded maintenance failure; no clinical content is retained."""


def digest(content):
    return hashlib.sha256(content).hexdigest()


def safePath(root, name):
    path = root / name
    if Path(name).is_absolute() or ":" in name or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or "\\" in name or ".." in Path(name).parts:
        raise ResealError("Unsafe maintenance path.")
    return path


def uniqueObject(pairs):
    record = {}
    for name, content in pairs:
        if name in record:
            raise ResealError("Duplicate maintenance field.")
        record[name] = content
    return record


def loadReview(root):
    review = json.loads(safePath(root, Targets[0]).read_bytes(), object_pairs_hook=uniqueObject)
    expected = {"schemaVersion", "reviewStatus", "competitionStatus", "notice", "productionApproved", "files"}
    if (set(review) != expected or type(review["schemaVersion"]) is not int or review["schemaVersion"] != 1 or review["reviewStatus"] != "reviewedForEvaluation"
            or review["competitionStatus"] != "competitionReady" or review["productionApproved"] is not False
            or review["notice"] != "Reviewed with healthcare professionals for evaluation and feedback. Not validated or approved for patient care."
            or not isinstance(review["files"], dict) or not review["files"]):
        raise ResealError("Malformed maintenance review.")
    if not set(Protected).issubset(review["files"]):
        raise ResealError("Missing clinical integrity bindings.")
    for name, pin in review["files"].items():
        if not isinstance(name, str) or not isinstance(pin, str) or len(pin) != 64 or any(char not in "0123456789abcdef" for char in pin):
            raise ResealError("Malformed maintenance review.")
    return review


def calculate(root, additions=()):
    """One canonical byte calculation; protected clinical content cannot be resealed."""
    review = loadReview(root)
    for name, pin in Protected.items():
        if digest(safePath(root, name).read_bytes()) != pin:
            raise ResealError("Clinical content requires separate human review.")
    for name, count in [("evaluation/modules/module1/claims.json", 57), ("evaluation/modules/module2/claims.json", 21)]:
        if len(json.loads(safePath(root, name).read_bytes())["claims"]) != count:
            raise ResealError("Clinical inventory changed.")
    # Additions are explicit reviewed source paths, never an automatic directory walk.
    names = sorted(set(review["files"]) | set(additions))
    inventory = set((root / "ReleaseFiles.txt").read_text(encoding="utf-8").splitlines())
    if any(name not in inventory for name in names):
        raise ResealError("Unlisted maintenance path.")
    from tools.releaseExport import checkRelease
    pins = checkRelease(root, names)
    review["files"] = pins
    reviewBytes = (json.dumps(review, indent=2, ensure_ascii=False) + "\n").encode()
    pin = digest(reviewBytes)
    py = ('"""Trusted review pin; deliberate changes require evaluation review and tests."""\n\nReviewHash = "' + pin + '"\n').encode()
    ts = ("// Trusted review pin; never regenerated during application startup or build.\nexport const ReviewHash = '" + pin + "';\n").encode()
    return dict(zip(Targets, (reviewBytes, py, ts)))


def replaceBytes(path, content):
    pending = path.with_name(path.name + ".resealPending")
    try:
        with pending.open("xb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)


def verify(root, expected):
    if any(safePath(root, name).read_bytes() != content for name, content in expected.items()):
        raise ResealError("Integrity write verification failed.")
    pin = digest(expected[Targets[0]])
    if pin.encode() not in expected[Targets[1]] or pin.encode() not in expected[Targets[2]]:
        raise ResealError("Integrity representations disagree.")


def recover(root):
    journal = safePath(root, Journal)
    if journal.stat().st_size > 200000:
        raise ResealError("Invalid recovery journal.")
    original = json.loads(journal.read_bytes(), object_pairs_hook=uniqueObject)
    if set(original) != set(Targets):
        raise ResealError("Invalid recovery journal.")
    contents = {name: bytes.fromhex(original[name]) for name in Targets}
    for name, content in contents.items():
        safePath(root, name).with_name(Path(name).name + ".resealPending").unlink(missing_ok=True)
        replaceBytes(safePath(root, name), content)
    if any(safePath(root, name).read_bytes() != content for name, content in contents.items()):
        raise ResealError("Recovery verification failed.")
    journal.unlink()


def writeReviewed(root, generated):
    journal = safePath(root, Journal)
    if journal.exists():
        raise ResealError("Recover the interrupted operation first.")
    original = {name: safePath(root, name).read_bytes().hex() for name in Targets}
    with journal.open("xb") as handle:
        handle.write((json.dumps(original, sort_keys=True) + "\n").encode())
        handle.flush()
        os.fsync(handle.fileno())
    try:
        for name, content in generated.items():
            replaceBytes(safePath(root, name), content)
        verify(root, generated)
    except BaseException:
        recover(root)
        raise
    journal.unlink()


def main():
    parser = argparse.ArgumentParser(description="Read-only integrity preview; no clinical approvals.")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--acknowledge-reviewed-nonclinical", dest="acknowledgeReviewed", action="store_true")
    parser.add_argument("--add", action="append", default=[])
    parser.add_argument("--recover", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        if args.recover:
            if not args.write or not args.acknowledgeReviewed or args.add:
                parser.error("Recovery requires explicit write acknowledgement and no additions.")
            recover(root)
            print("Recovered the previous integrity files; inspect and validate before resealing.")
            return
        if (root / Journal).exists():
            raise ResealError("Recover the interrupted operation first.")
        generated = calculate(root, args.add)
        previous = loadReview(root)["files"]
        for name, pin in json.loads(generated[Targets[0]])["files"].items():
            if previous.get(name) != pin:
                print(name + " " + pin + " reviewed binding would change")
        for name, content in generated.items():
            print(name + " " + digest(content) + (" unchanged" if safePath(root, name).read_bytes() == content else " would change"))
        if args.write:
            if not args.acknowledgeReviewed:
                parser.error("Writing requires --acknowledge-reviewed-nonclinical.")
            writeReviewed(root, generated)
            print("Integrity representations agree. No clinical content or Git state changed.")
    except (OSError, ValueError, KeyError, TypeError):
        parser.exit(1, "Integrity maintenance failed; inspect inputs or recover the interrupted operation.\n")


if __name__ == "__main__":
    main()

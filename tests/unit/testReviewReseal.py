"""Offline maintenance regression tests; no clinical originals or network required."""

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from tools import reviewReseal

Root = Path(__file__).resolve().parents[2]


@pytest.fixture
def releaseRoot(tmp_path):
    for name in (Root / 'ReleaseFiles.txt').read_text().splitlines():
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(Root / name, target)
    return tmp_path


def testDryRunDeterministicAndNoWrites(releaseRoot, monkeypatch):
    import socket
    monkeypatch.setattr(socket, 'socket', lambda *args, **kwargs: pytest.fail('Network forbidden'))
    before = {name: (releaseRoot / name).read_bytes() for name in reviewReseal.Targets}
    first = reviewReseal.calculate(releaseRoot)
    assert first == reviewReseal.calculate(releaseRoot)
    assert before == {name: (releaseRoot / name).read_bytes() for name in reviewReseal.Targets}


def testExplicitWriteAcknowledgement():
    outcome = subprocess.run([sys.executable, '-B', '-m', 'tools.reviewReseal', '--write'], cwd=Root, capture_output=True, text=True)
    assert outcome.returncode != 0
    assert 'acknowledge-reviewed-nonclinical' in outcome.stderr
    assert not (Root / reviewReseal.Journal).exists()


@pytest.mark.parametrize('name', list(reviewReseal.Protected))
def testRefusesChangedClinicalBytes(releaseRoot, name):
    target = releaseRoot / name
    target.write_bytes(target.read_bytes() + b' ')
    with pytest.raises(reviewReseal.ResealError, match='separate human review'):
        reviewReseal.calculate(releaseRoot)


def testMalformedReviewRejected(releaseRoot):
    target = releaseRoot / reviewReseal.Targets[0]
    content = json.loads(target.read_bytes())
    content['productionApproved'] = True
    target.write_text(json.dumps(content))
    with pytest.raises(reviewReseal.ResealError):
        reviewReseal.calculate(releaseRoot)


def testAtomicFailureRestoresAllFiles(releaseRoot, monkeypatch):
    before = {name: (releaseRoot / name).read_bytes() for name in reviewReseal.Targets}
    generated = reviewReseal.calculate(releaseRoot)
    original = reviewReseal.replaceBytes
    attempts = 0
    def failSecond(path, content):
        nonlocal attempts
        attempts += 1
        if attempts == 2:
            raise OSError('Synthetic replacement failure')
        original(path, content)
    monkeypatch.setattr(reviewReseal, 'replaceBytes', failSecond)
    with pytest.raises(OSError):
        reviewReseal.writeReviewed(releaseRoot, generated)
    assert before == {name: (releaseRoot / name).read_bytes() for name in reviewReseal.Targets}
    assert not (releaseRoot / reviewReseal.Journal).exists()


def testGeneratedRepresentationsAgree(releaseRoot):
    generated = reviewReseal.calculate(releaseRoot)
    metadata = json.loads((releaseRoot / reviewReseal.Targets[0]).read_bytes())
    reviewReseal.writeReviewed(releaseRoot, generated)
    reviewReseal.verify(releaseRoot, generated)
    assert reviewReseal.calculate(releaseRoot) == generated
    review = json.loads(generated[reviewReseal.Targets[0]])
    assert {name: entry for name, entry in review.items() if name != 'files'} == {name: entry for name, entry in metadata.items() if name != 'files'}
    for name, pin in review['files'].items():
        assert hashlib.sha256((releaseRoot / name).read_bytes()).hexdigest() == pin
    assert not (releaseRoot / reviewReseal.Journal).exists()


def testRecoveryAfterInterruption(releaseRoot):
    before = {name: (releaseRoot / name).read_bytes() for name in reviewReseal.Targets}
    (releaseRoot / reviewReseal.Journal).write_text(json.dumps({name: content.hex() for name, content in before.items()}))
    (releaseRoot / reviewReseal.Targets[1]).write_bytes(b'Interrupted write')
    reviewReseal.recover(releaseRoot)
    assert before == {name: (releaseRoot / name).read_bytes() for name in reviewReseal.Targets}


def testNoRuntimeBuildInvocation():
    for folder in ['backend', 'netlify', 'frontend/src', 'frontend/scripts']:
        for source in (Root / folder).rglob('*'):
            if source.suffix in {'.py', '.ts', '.tsx', '.mjs', '.json'}:
                assert 'reviewReseal' not in source.read_text(encoding='utf-8-sig')
    assert 'reviewReseal' not in (Root / 'frontend/package.json').read_text()


def testUnknownArgumentsRejected():
    outcome = subprocess.run([sys.executable, '-B', '-m', 'tools.reviewReseal', '--unknown'], cwd=Root, capture_output=True)
    assert outcome.returncode != 0

def testExistingRuntimeValidatorAcceptsGenerated(releaseRoot, monkeypatch):
    from backend.competition import evaluation, evaluationSeal
    generated = reviewReseal.calculate(releaseRoot)
    reviewReseal.writeReviewed(releaseRoot, generated)
    monkeypatch.setattr(evaluation, 'ProjectRoot', releaseRoot)
    monkeypatch.setattr(evaluation, 'EvaluationRoot', releaseRoot / 'evaluation')
    monkeypatch.setattr(evaluationSeal, 'ReviewHash', hashlib.sha256(generated[reviewReseal.Targets[0]]).hexdigest())
    assert evaluation.verifyReview()['productionApproved'] is False


def testFailedPostWriteVerificationRollsBack(releaseRoot, monkeypatch):
    original = {name: (releaseRoot / name).read_bytes() for name in reviewReseal.Targets}
    def rejectGenerated(root, generated):
        raise reviewReseal.ResealError('Synthetic verification failure')
    generated = reviewReseal.calculate(releaseRoot)
    monkeypatch.setattr(reviewReseal, 'verify', rejectGenerated)
    with pytest.raises(reviewReseal.ResealError):
        reviewReseal.writeReviewed(releaseRoot, generated)
    assert original == {name: (releaseRoot / name).read_bytes() for name in reviewReseal.Targets}


def testRefusesUnlistedPaths(releaseRoot):
    with pytest.raises(reviewReseal.ResealError, match='Unlisted'):
        reviewReseal.calculate(releaseRoot, ['.testUnexpected.json'])

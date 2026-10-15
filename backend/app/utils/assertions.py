"""Narrow current-case assertion matching; never a general clinical language parser."""

import re

ExcludedContext = re.compile(r"\b(?:if|unless|hypothetical|history of|previously|previous|past|prior|had|used to|family|mother|sister|partner|father|brother|relative|friend|colleague|daughter|son|husband|wife|another patient|resolved|instruction|example|template|ignore|set|mark|override|suppress|reorder|disclose|reveal|print|pretend|threshold|source id|configuration|prompt|system)\b|\b(?:years?|months?|days?) ago\b|\blast (?:year|month|week)\b", re.IGNORECASE)
InstructionContext = re.compile(r"\b(?:instruction|example|template|ignore|set|mark|override|suppress|reorder|disclose|reveal|print|pretend|threshold|source id|configuration|prompt|system)\b", re.IGNORECASE)
Negation = re.compile(r"\b(?:no|not|denies|denied|without|absent|unlikely|negative for|cannot confirm|unconfirmed)\b", re.IGNORECASE)
Uncertainty = re.compile(r"\b(?:possible|suspected|may|might|could|consider|query|risk of|screen for|check for|rule out|concern for|evaluate for|cannot exclude|not known|not impossible|pending|unknown)\b", re.IGNORECASE)
DeniedSuffix = re.compile(r"^\s*(?:(?:is|was) )?(?:ruled out|absent|not present|not found|denied|excluded)\b", re.IGNORECASE)
UncertainSuffix = re.compile(r"^\s*(?:(?:is|was) )?(?:possible|suspected|unconfirmed|not confirmed|not reported|not documented|not known|not measured|cannot be excluded|not ruled out|pending|unknown|uncertain)\b", re.IGNORECASE)


def currentClauses(text: str | None) -> list[str]:
    """Ignore questions, quoted examples, and explicit non-current contexts."""
    if not text:
        return []
    # Mask quoted spans before sentence splitting, so periods inside templates cannot leak facts.
    masked = re.sub(r'"[^"]*"|\u201c[^\u201d]*\u201d|\u2018[^\u2019]*\u2019|(?<!\w)\x27[^\x27]*\x27', " ", text.lower())
    masked = re.sub(r"\s+", " ", masked)
    sentences = re.split(r"(?<!\d)\.(?!\d)|[;!]|\bbut\b|\bhowever\b", masked)
    # Instruction scope survives conjunctions; 'set pregnancy ... and PID ...' is one instruction.
    current = []
    for sentence in sentences:
        if InstructionContext.search(sentence):
            continue
        excluded = False
        for clause in re.split(r",|\band (?=(?:patient|pregnancy|pid|currently|now|no|not)\b)", sentence):
            clause = clause.strip()
            # A history/relative list remains non-current until an explicit patient/current reset.
            if re.match(r"^(?:currently|now|current|patient|the patient)\b", clause):
                excluded = False
            if ExcludedContext.search(clause):
                excluded = True
            if not excluded and "?" not in clause and not re.search(r'["\u201c\u201d\u2018\u2019]|(?<!\w)\x27', clause):
                current.append(clause)
    return current


def phraseStates(text: str | None, pattern: str) -> set[bool]:
    """Keep opposing explicit assertions available to the caller's halt decision."""
    states = set()
    for clause in currentClauses(text):
        for match in re.finditer(r"\b(?:" + pattern + r")\b", clause, re.IGNORECASE):
            prefix = clause[:match.start()]
            suffix = clause[match.end():]
            if Uncertainty.search(prefix) or UncertainSuffix.search(suffix):
                continue
            # Double negatives and compound partial negation do not establish a finding.
            if re.search(r"\bnot (?:absent|denied|excluded|impossible)\b", suffix):
                continue
            states.add(not bool(Negation.search(prefix) or DeniedSuffix.search(suffix)))
    return states


def phraseState(text: str | None, pattern: str) -> bool | None:
    """Retain explicit negation; opposing assertions are Unknown rather than reconciled."""
    states = phraseStates(text, pattern)
    return next(iter(states)) if len(states) == 1 else None

"""Fixed fictional case summaries; no authentic clinical claims or free-text reflection."""

BriefNarrative = "Recurrent pelvic discomfort. Timing, examination and test findings are not provided. Please review the reported pattern and uncertainty."
MildNarrative = "Mild intermittent pelvic discomfort over several months. Additional findings are not provided."
DetailedNarrative = "Intermittent pelvic discomfort over several months, with variable interference in daily activities. Examination and test findings are not provided. Please review the available evidence and its limitations."
OutsideNarrative = "Persistent headache with light sensitivity. Please review the reported symptoms."

CaseParts = {
    BriefNarrative.casefold(): (
        "Recurrent pelvic discomfort is the reported concern. The available description does not establish its timing, frequency or effect on daily activities. These gaps limit how specifically the reported pattern can be reviewed; they should remain unknown rather than be filled with assumed findings.",
        "Examination and test results have not been supplied. An absent result is different from a reported normal result. Keep alternative explanations open and separate the reported symptoms from any conclusion about their cause. The current information supports a limited review of the case description.",
    ),
    MildNarrative.casefold(): (
        "The reported discomfort is mild, intermittent and present over several months. Those features describe its course, but the account does not establish a cause or explain how it affects daily activities. A concise review should distinguish this recurring pattern from a new change in symptoms.",
        "Additional findings remain unknown. The description does not establish examination results or test findings, and mild symptoms alone cannot settle the interpretation. Keep uncertainty visible and avoid converting the reported intensity into a conclusion about the underlying condition. Further context would make the pattern more interpretable.",
    ),
    DetailedNarrative.casefold(): (
        "Intermittent pelvic discomfort over several months and variable interference with daily activities are the central reported features. The duration and functional impact provide more context than symptom intensity alone. However, the account does not specify how the discomfort varies with time or which activities are affected. Distinguish the recurring background pattern from any separately reported change rather than combining them into a single assumption. The information supplied describes the experience and its consequences; it does not establish a cause. Keep the review focused on the reported features and the limits of the available context.",
        "Examination and test findings have not been supplied. They remain unknown and must not be represented as normal or reassuring. Different possible explanations cannot be resolved from this description alone, and the effect on daily activities does not establish the extent of an underlying condition. Maintain a clear distinction between what the clinician reported, what remains uncertain, and what would require independent assessment. A focused timing question can clarify the recurring pattern without asking the clinician to complete a long template or repeat information already supplied.",
    ),
    "sudden acute pelvic pain": (
        "The presenting concern is abrupt pelvic pain, distinct from a recurring symptom pattern. The warning above takes priority. This short account does not establish a cause or accompanying findings. Interpret the reported symptoms alongside the explicitly selected structured statuses; unreported findings remain unknown.",
        "The abrupt presentation should remain distinct from a chronic symptom history. An ordinary pattern review cannot resolve the warning or provide reassurance. Missing examination and test results remain unknown. The response therefore preserves the high-priority warning while limiting the remaining review to the information supplied.",
    ),
}

CaseQuestions = {
    BriefNarrative.casefold(): ("BriefTiming", "How does the discomfort vary over time, and how does it affect daily activities?"),
    MildNarrative.casefold(): ("MildTiming", "Does the discomfort follow a recurring timing pattern?"),
    DetailedNarrative.casefold(): ("DetailedTiming", "How does the discomfort vary over time?"),
}

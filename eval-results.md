# MatterPilot — Eval Results

_Generated: 2026-05-26T17:44:41.586Z_  ·  packs: **court-notice (20), contract-review (8)**
## Pack 1 — Court Notice Intake

Fixtures: **20** (legit 16, phishing 4) · model `llama-3.3-70b-versatile` via Groq

### Headline metrics

| Metric | Result | Target |
| --- | ---: | ---: |
| Case-number match accuracy | **100.0%** | ≥ 98% |
| Notice-type classification accuracy (legit only) | **100.0%** | ≥ 90% |
| Final-status accuracy | **100.0%** | ≥ 90% |
| Straight-through rate (legit → routed) | **100.0%** | ≥ 60% |
| Phishing detection recall | **100.0%** | ≥ 95% |
| Phishing false-positive rate (legit → suspicious) | **0.0%** | ≤ 5% |
| Median ingest latency (LLM stages) | **2.75s** | < 8s |

### Field extraction (F1 per field)

| Field | Precision | Recall | F1 | TP | FP | FN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| hearingAt | 100.0% | 100.0% | 100.0% | 8 | 0 | 0 |
| courtroom | 71.4% | 100.0% | 83.3% | 5 | 2 | 0 |
| virtualUrl | 100.0% | 100.0% | 100.0% | 2 | 0 | 0 |
| trustee | 83.3% | 100.0% | 90.9% | 5 | 1 | 0 |
| judge | 100.0% | 100.0% | 100.0% | 7 | 0 | 0 |
| deadline | 91.7% | 91.7% | 91.7% | 11 | 1 | 1 |

**Macro-F1 across fields**: 94.3% (target ≥ 85%)

### Per-fixture detail

| Fixture | Case | Type | Status | Conf. | Lat (s) | Errors |
| --- | --- | --- | --- | ---: | ---: | --- |
| `341-meeting-inperson-txsb` | ✓ 25-30412 | ✓ meeting_341 | ✓ routed | 91% | 1.6 |  |
| `341-meeting-legit` | ✓ 25-12345 | ✓ meeting_341 | ✓ routed | 90% | 1.1 |  |
| `341-meeting-rescheduled-flsb` | ✓ 25-18077 | ✓ meeting_341 | ✓ routed | 90% | 0.8 |  |
| `341-meeting-zoom-cacb-ch13` | ✓ 25-22890 | ✓ meeting_341 | ✓ routed | 89% | 1.0 |  |
| `claim-deadline-amended-mnb` | ✓ 24-32189 | ✓ claim_deadline | ✓ routed | 91% | 0.8 |  |
| `claim-deadline-bar-date-ncwb` | ✓ 25-50901 | ✓ claim_deadline | ✓ routed | 91% | 1.0 |  |
| `deficiency-fees-mieb` | ✓ 25-41229 | ✓ deficiency | ✓ routed | 91% | 0.9 |  |
| `deficiency-legit` | ✓ 25-44321 | ✓ deficiency | ✓ routed | 91% | 0.9 |  |
| `deficiency-schedules-ganb` | ✓ 25-55104 | ✓ deficiency | ✓ routed | 91% | 4.0 |  |
| `discharge-ch13-ohnb` | ✓ 22-13456 | ✓ discharge | ✓ routed | 87% | 7.1 |  |
| `discharge-ch7-vaeb` | ✓ 25-72018 | ✓ discharge | ✓ routed | 91% | 6.9 |  |
| `discharge-legit` | ✓ 24-09876 | ✓ discharge | ✓ routed | 87% | 7.1 |  |
| `motion-to-dismiss-failure-disclose-cob` | ✓ 24-58221 | ✓ motion_to_dismiss | ✓ routed | 89% | 8.2 |  |
| `motion-to-dismiss-trustee-paeb` | ✓ 25-19045 | ✓ motion_to_dismiss | ✓ routed | 90% | 8.3 |  |
| `phishing-fake-nef` | ✓ 25-77777 | ✓ (suspicious) | ✓ suspicious | — | 0.0 |  |
| `phishing-gmail-clerk` | ✓ 25-99012 | ✓ (suspicious) | ✓ suspicious | — | 0.0 |  |
| `phishing-pacer-com` | ✓ 25-66677 | ✓ (suspicious) | ✓ suspicious | — | 0.0 |  |
| `phishing-uscoorts` | ✓ 25-88888 | ✓ (suspicious) | ✓ suspicious | — | 0.0 |  |
| `relief-from-stay-lease-tnmd` | ✓ 25-26803 | ✓ relief_from_stay | ✓ routed | 91% | 7.4 |  |
| `relief-from-stay-secured-azb` | ✓ 25-04412 | ✓ relief_from_stay | ✓ routed | 91% | 8.0 |  |

### Methodology

- Eval set: 20 synthetic notices modeled on official bankruptcy forms (309A, 122A, B 318, etc.).
  Real PACER and BNC samples should be added before any public claim about performance.
- Deterministic stage (case number regex, sender allowlist, link host check) runs first.
- Notices flagged `suspicious` skip the LLM stage entirely (saves tokens).
- LLM stage uses Groq `llama-3.3-70b-versatile` tool-use with temperature 0.
- Status routing threshold (`REVIEW_CONFIDENCE_THRESHOLD`): **0.75**.
- Field matches use case/punctuation-normalized contains; datetimes ±5 minutes; dates same YYYY-MM-DD.
- All notice text, names, trustees, and judges are synthetic. Notice types are seven enum values.

---

## Pack 2 — Contract Playbook Review

Fixtures: **8** (errored 0) · model `llama-3.3-70b-versatile` via Groq · playbooks: 3 (Mutual NDA, MSA, Service Agreement)

### Headline metrics

| Metric | Result | Target |
| --- | ---: | ---: |
| Clause-type recall (macro) | **100.0%** | ≥ 85% |
| Playbook-rule match accuracy (macro) | **100.0%** | ≥ 75% |
| Risk-level accuracy (macro) | **81.3%** | ≥ 75% |
| Review-status accuracy | **100.0%** | ≥ 85% |
| Flagged-count MAE | **0.13** | ≤ 1.0 |
| Median per-fixture latency | **12.92s** | < 10s |

### Per-fixture detail

| Fixture | Playbook | Status | Clauses (matched/expected/observed) | Rule match | Risk acc. | Flagged (obs/exp) | Conf. | Lat (s) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `msa-balanced` | msa | ✓ needs review | 4/4/7 | 100.0% | 50.0% | 2/2 | 84% | 12.7 |
| `msa-clean` | msa | ✓ auto approved | 4/4/7 | 100.0% | 100.0% | 0/0 | 84% | 14.9 |
| `msa-vendor-friendly` | msa | ✓ needs review | 4/4/5 | 100.0% | 75.0% | 4/4 | 70% | 20.2 |
| `mutual-nda-clean` | mutual-nda | ✓ auto approved | 4/4/4 | 100.0% | 100.0% | 0/0 | 86% | 13.8 |
| `nda-mixed` | mutual-nda | ✓ needs review | 4/4/4 | 100.0% | 75.0% | 2/2 | 88% | 13.1 |
| `one-way-nda-bad` | mutual-nda | ✓ needs review | 4/4/4 | 100.0% | 50.0% | 3/4 | 70% | 11.1 |
| `service-bad` | service-agreement | ✓ needs review | 2/2/3 | 100.0% | 100.0% | 2/2 | 78% | 12.7 |
| `service-clean` | service-agreement | ✓ auto approved | 2/2/4 | 100.0% | 100.0% | 0/0 | 90% | 10.8 |

### Methodology

- Eval set: 8 synthetic contracts covering Mutual NDA, MSA, and Service Agreement archetypes.
- LLM stage uses Groq `llama-3.3-70b-versatile` tool-use with temperature 0 — one combined call returns clauses + classification + playbook match + risk + redline.
- Clause pairing: each expected clause is matched to one observed clause of the same `clauseType`, preferring matches that also share `matchedPlaybookRuleId`. Surplus observed clauses do not penalise recall but show up in the observed-count column.
- Review status mirrors the pack threshold (`AUTO_APPROVE_FLAGGED_THRESHOLD = 0`): any clause with risk medium or high routes the document to `needs_review`.
- All contract text, parties, and clause language are synthetic. Real third-party contract corpora should be added before any public performance claim.

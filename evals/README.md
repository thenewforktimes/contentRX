# Evals

The evaluation suite tests the agent against every standard in the library. Each standard has a correct example (should pass) and an incorrect example (should fail), giving 58 test cases total.

## What it measures

- **Accuracy** — percentage of cases where the agent's verdict matches the expected result
- **Stability** — whether the same case gets the same result across multiple runs
- **False positive rate** — how often passing content gets incorrectly flagged
- **Standard ID accuracy** — whether the agent cites the right standard when it flags a violation
- **Latency** — response time per check
- **Cost** — estimated API cost per run

## Latest results

From 3 consecutive runs against `claude-sonnet-4-20250514`:

- Accuracy: 100% (all 3 runs)
- Stable passes: 58/58
- Unstable cases: 0/58

Full results: [`results/stability_report.md`](results/stability_report.md)

## Running evals

The eval runner script (`run_evals.py`) is not yet included in this repo. It reads the standards library, runs each correct/incorrect example through the agent, and produces the stability report.

Coming soon:

- [ ] `run_evals.py` with CLI flags for number of runs and model selection
- [ ] CI integration for automated eval runs on PR

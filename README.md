# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/LoganZ2/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/LoganZ2/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Peer-calibrated token launch radar ranking all 197 clean pre-token protocols (40/40 watchlist + 157 early discoveries) using Huber-IRLS log-TVL + chain-count + Empirical-Bayes category regression validated on both Leave-One-Out CV and Walk-Forward blind splits, empirical token launch odds from 437 clean protocols, honest out-of-sample range bands, and costed `$/hr` farm playbooks.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=m9c4qk0v&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

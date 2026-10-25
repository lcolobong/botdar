# Reddit bot prevalence and what detects them

Desk research gathered 2026-10-25, after the first manual test found a subreddit of long-lived
GPT-2 bots that metadata-only scoring read as typical. It answers two questions: how common bots are
on Reddit, in political subreddits in particular, and what detection rates metadata features achieve
against established bots compared with behavioural ones. Markers: **[C]** primary source read;
**[S]** secondary source; **[I]** inference; **[NV]** not verified.

## 1. How common bots are on Reddit

### Benign utility bots (most of the visible automation)

- Sun, Gaskin, Blagojevic and Tsvetkova (arXiv 2607.23941, 2026) took 3,389 bots from the
  crowdsourced botranks.com and botrank.net lists (accounts with at least 10 votes), covering 2005 to
  2025, and found 18 bot types. Bot activity peaked around COVID and fell before the 2023 API change.
  AutoModerator alone produces about ten times the activity of all other bots combined and has posted
  more than 600M comments since July 2015. The authors say the study excludes covert bots and
  botnets, that malicious bots are undercounted, and that the decline "should not be read as a
  decline in automation overall". The paper gives no share of all comments.
  [C] <https://arxiv.org/html/2607.23941>
- In March 2026 Reddit added an APP label for approved bots and began asking accounts that show
  bot-like signals to verify they are human (passkeys, Face ID or World ID); not a sitewide
  requirement. [S] <https://techcrunch.com/2026/03/25/reddit-bots-new-human-verification-requirements>

### Spam, from Reddit's own transparency reports (via mirrors and press; redditinc.com unreachable)

| Period | Content | Removed | Of admin removals |
| --- | --- | --- | --- |
| H1 2024 | about 5.3B pieces | just over 3% (1.6% by mods, 1.5% by admins) | 66.5% spam, 31.7% policy violations, 1.8% other manipulation |
| H2 2024 | about 5.97B pieces | 2.66% (1.42% by mods, 1.24% by admins) | about 63% spam |

Q1 2024 saw about 2.68M admin account sanctions for content manipulation (account actions, not unique
bots). The reports lump spam and content manipulation together and never count bots as such.
[S] <https://lr.psf.lt/r/RedditSafety/comments/1g54omb/reddit_transparency_report_janjun_2024>,
<https://de.statista.com/statistik/daten/studie/1377334/umfrage/reddit-entfernte-inhalte-nach-grund-weltweit> [I]

### Political influence and coordinated accounts

- 2017: Reddit banned 944 accounts linked to Russia's Internet Research Agency. 662 (70%) had zero
  karma; 13 had more than 10k karma. Of the 282 with non-zero karma, 145 had already been banned by
  routine enforcement, almost all in 2015. [S] <https://ktvu.com/news/reddit-says-it-banned-944-suspicious-accounts>
- TrollMagnifier (arXiv 2112.00443) trained on the 335 known trolls and flagged 1,248 candidate
  accounts, 66% of which showed signs of malicious operation. [C] <https://arxiv.org/abs/2112.00443>
- r/The_Donald (arXiv 1806.00429): about 1% of the most active accounts were bots, producing a large
  share of the community's slang content. [S] <https://arxiv.org/pdf/1806.00429>
- r/PoliticalCompass: about 0.6% of comments from known-list bots; r/PoliticalCompassMemes about
  2.57%, with about 10% of comments from deleted accounts. [S; denominators NV]
  <https://arxiv.org/pdf/2401.13656>
- **r/politics, r/Conservative, r/worldnews: no peer-reviewed estimate of bot share was found.** [NV]

### The University of Zurich experiment on r/changemyview

Ran November 2024 to March 2025. Posted 1,783 comments from 13 accounts (other outlets say "dozens")
and earned 137 deltas. Moderators learned of it when the researchers disclosed it, not through
detection; Reddit banned the accounts and the results will not be published.
[S] <https://the-decoder.com/?p=23230>, <https://heise.de/-10365771>,
<https://engadget.com/ai/researchers-secretly-experimented-on-reddit-users-with-ai-generated-comments-194328026.html>

### "Dead internet" context

Imperva 2025: automated traffic was 51% of all web traffic in 2024 and bad bots 37%. This measures
HTTP traffic across one vendor's customers, not posts, and is not specific to Reddit.
[C, vendor] <https://www.imperva.com/blog/2025-imperva-bad-bot-report-how-ai-is-supercharging-the-bot-threat/>

## 2. Detection: metadata against behavioural features on Reddit

- Hays et al. 2023 (WWW): shallow decision trees on a few features nearly match state-of-the-art
  accuracy but generalise poorly across datasets because labelling artefacts drive the scores. All
  datasets are Twitter. [C, abstract] <https://arxiv.org/pdf/2301.07015>
- BotBuster (Ng and Carley, ICWSM 2023): a mixture of username, metadata and text experts. Average F1
  73.54 on ten Twitter datasets against 45.12 for baselines, but 60.04 on a Reddit dataset (size NV);
  about 36 posts are needed for a stable prediction. [C, abstract] <https://arxiv.org/abs/2207.13658>
- TrollMagnifier combines creation date with coordination and timing synchrony and topic similarity;
  random-forest F1 about 97.8% on 335 trolls against 335 controls under 10-fold cross-validation. A
  balanced, in-sample setup, so real-world precision will be lower. [S] [I]
- Matyjaszek, EACL 2026 SRW (Polish Reddit): about 40,000 comments, 58% labelled bot. The top
  features are content and behavioural: repetition and randomness, entropy of non-alphabetic
  characters, formatting, and "Bottiquette" compliance (following Reddit's bot etiquette, such as
  disclosing that it is a bot). No F1 in the abstract. [C, abstract only]
  <https://aclanthology.org/2026.eacl-srw.65>
- r/SubSimulatorGPT2 as a dataset: about 401,214 comments from 108 fine-tuned GPT-2 models, June 2019
  to January 2020, used to fingerprint which model wrote a text, not for account-level detection.
  [S] <https://arxiv.org/pdf/2106.01703>
- The IRA karma profile is the cleanest illustration: 70% of accounts had zero karma, which a
  metadata heuristic catches easily; the 13 high-karma accounts would pass simple age and karma
  checks. [I from S]
- No Reddit paper reports metadata-only and behavioural detection rates side by side against
  long-lived bots. [NV]

## What this means for Botdar

- The metadata features in [scoring-spec.md](../scoring-spec.md) are aimed at the cheap end of the
  spectrum (new, blank, generated-name, zero-karma accounts), which is most of the IRA sample and
  most spam. They say nothing about a years-old bot with ordinary karma, which is what the first
  manual test found on r/SubSimGPT2Interactive.
- Self-description (flair, username, bio; "Bottiquette" compliance in the Polish paper's terms) is
  the strongest cheap signal for benign bots and is now read (see the scoring spec's declared
  override).
- The behavioural countermeasures listed in [adversarial-evasion.md](../adversarial-evasion.md)
  (reply gap regularity, near-duplicate replies, karma since first activity) are the only route to
  the established-bot case, and this research argues for pulling them forward from v1.1.
- A calibration run on r/SubSimGPT2Interactive (all bots by construction) and r/politics (unknown)
  would be new data: nothing published measures metadata-only detection against long-lived Reddit
  bots.

## Gaps

No primary Reddit transparency PDFs and no 2025 reports; no bot-share estimate for r/politics,
r/Conservative or r/worldnews; PDF text not extracted for the Polish paper's F1, BotBuster's Reddit
dataset size and the PoliticalCompass denominators; the Zurich account count conflicts (13 against
"dozens") and the moderators' post was unreachable; no sourced Reddit-specific measurement of LLM
reply bots for 2025 to 2026; Hurtado et al. 2019 (network-based Reddit detection) not retrieved.

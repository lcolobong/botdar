# Bot-detection heuristics: what the literature says about cheap, metadata-only signals

Date researched: 2026-10-22

## Summary and verdict

- Metadata-only models (BotometerLite's 20 profile features in a random forest) reach 0.95–0.99 AUC *within* a dataset but only about 0.6–0.75 on unseen populations. Hays et al. (2023) show depth-1 decision trees match the state of the art on benchmarks and that cross-dataset transfer is near chance: benchmark scores reflect how datasets were collected, not a stable bot/human difference.
- A model trained on the public datasets would not reliably beat hand-set rules on 2026 populations. Recommended MVP: hand-tuned weighted log-odds heuristics with capped per-feature contributions, bucketed into three tiers; collect opt-in feedback; fit a tiny calibrated model later.
- Ranked cheap signals: activity rate (posts per day of account age); friends/following count and the followers/friends ratio; account age; handle shape (length, digits, bigram likelihood); engagement given; profile completeness (default image, empty bio, no URL).
- False positives are the main risk: at the usual threshold Botometer's precision on real people was 0.59 (41% of flagged accounts were human). The UI must show reasons, never say "bot" or "fake" about a named account, and require at least two independent signals for the top tier.
- LLM-driven reply bots (fox8) evade both metadata and text detectors; coordination (shared links, mutual replies) was the only reliable tell.
- No usable pretrained lightweight model exists, and the training-era fields are mostly not visible on today's X web client.

## Botometer feature families, and how much signal metadata alone carries

### Confirmed

- **Botometer v2/v3.** Varol et al. (ICWSM 2017) used more than 1,000 features in six classes: user metadata, friends, network, temporal, content and sentiment. A random forest scored 0.95 AUC under 5-fold cross-validation. User metadata was the best class on its own ("We achieved the best performance with user meta-data features"). Content also scored above 0.9 AUC, and the other classes scored above 0.8. The top 10 features alone reach about 0.9 AUC. The paper estimates that 9–15% of active accounts were bots in 2017. [arXiv 1703.03107](https://arxiv.org/abs/1703.03107), [ar5iv](https://ar5iv.labs.arxiv.org/html/1703.03107)
- **BotometerLite** (Yang et al., AAAI 2020, "Scalable and Generalizable Social Bot Detection through Data Selection"):
  - 20 features: 10 raw and 10 derived.
  - Raw: `statuses_count`, `followers_count`, `friends_count`, `favourites_count`, `listed_count`, `default_profile`, `profile_use_background_image`, `verified`, `name_length`, `description_length`.
  - Derived: `tweet_freq` (statuses / user_age), the growth rates of followers, friends, favourites and listed counts, `followers_friends_ratio`, `screen_name_length`, `num_digits_in_screen_name`, `num_digits_in_name`, `screen_name_likelihood`.
  - `user_age` is the number of hours between the probe time and account creation.
  - `screen_name_likelihood` is the geometric mean of character-bigram likelihoods, built from more than 2M screen names (3,969 possible bigrams).
  - The model is a random forest with 100 trees. The authors selected it by training on combinations of datasets and choosing the combination that generalised best.
  - AUC (Table 4), best model M196 vs. Botometer:

    | Test | M196 | Botometer |
    |---|---|---|
    | 5-fold cross-validation | 0.98 | 0.97 |
    | botwiki-verified | 0.99 | 0.92 |
    | midterm-18 | 0.99 | 0.96 |
    | gilani-17 | 0.68 | 0.67 |
    | cresci-rtbust | 0.60 | 0.71 |

  - Throughput is about 900M tweets/day on one machine. The per-tweet timing in the text is garbled.
  - SHAP direction: long screen names push toward bot. Verified, high favourites, high followers, high favourites growth and a high followers/friends ratio push toward human. High friends count and high friends growth push toward bot.
  - [ar5iv 1911.09179](https://ar5iv.labs.arxiv.org/html/1911.09179)
- **Kudugunta & Ferrara 2018.** Account-level detection using metadata reached "AUC > 99%". Tweet-level detection with a contextual LSTM reached "AUC > 96%". Both were measured on cresci-2017: 3,474 humans and 4,912 social spambots. [arXiv 1802.04289](https://arxiv.org/abs/1802.04289)
- **TwiBot-20/22 (NeurIPS 2022), which re-ran 35 baselines.** Metadata-heavy methods drop sharply on the newer data, especially in F1:

  | Method (feature-based) | Accuracy TwiBot-20 | Accuracy TwiBot-22 | F1 TwiBot-20 | F1 TwiBot-22 |
  |---|---|---|---|---|
  | Yang et al. (BotometerLite-style) | 81.6 | 75.1 | 84.9 | 36.6 |
  | BotHunter | 75.2 | 72.8 | 79.1 | 23.5 |
  | Kudugunta et al. | 59.6 | 65.9 | 47.3 | 51.7 |
  | Hayawi (DeeProBot) | 73.1 | 76.5 | 77.1 | 24.7 |
  | Abreu et al. | 73.4 | 70.7 | 77.1 | 53.4 |
  | Lee et al. | 77.4 | 76.3 | not read | not read |
  | Botometer (as re-run) | 53.1 | 49.9 | not read | not read |

  - Best graph neural network models: HGT at 86.9 accuracy on TwiBot-20, and BotRGCN at 79.7 accuracy on TwiBot-22.
  - [ar5iv 2206.04564](https://ar5iv.labs.arxiv.org/html/2206.04564)
- **BotArtist (Shevtsov et al.).** Uses 49 profile-only features: 23 counts, 21 real-valued (account age, ratios, per-age rates, name/screen-name entropy, character-class percentages, name-vs-handle Jaccard similarity) and 5 booleans (protected, verified, has_location, has_profile_image, has_profile_url). Lasso selects features, and the final model is one of SVM, random forest or XGBoost. Average F1 is 83.19 across 9 datasets when trained per dataset, and 68.5 when trained on the combined datasets. [arXiv 2306.00037v5](https://arxiv.org/html/2306.00037v5)
- **Cresci et al. 2015, "Fame for sale".** The most relevant result for a hand-tuned MVP. Rules proposed in the media (the 22-rule Camisani-Calzolari set, scored +human/−bot) had accuracy close to 0.5, high precision and very low recall: most fake followers were called human. Features from the spam-detection literature did much better, and their lightweight "Class A" classifier got more than 95% right. [PDF](https://arxiv.org/pdf/1509.04098)

### Inference

- With only metadata, the ranked signals are:
  1. activity rate (statuses per day of account age)
  2. friends/following count and the followers/friends ratio
  3. account age
  4. handle shape (length, digits, bigram likelihood)
  5. engagement given (favourites)
  6. profile completeness: default image, empty bio, no URL or location

  This is consistent with the SHAP results and with BotArtist's selected features.
- Expect roughly 0.95–0.99 AUC within a single dataset and roughly 0.6–0.75 on unseen populations.

## Failure modes and criticisms

### Confirmed

- **Rauchfleisch & Kaiser (PLOS ONE 2020).** Botometer v3 on 4,134 accounts reached AUC 0.85 overall, against 0.94 claimed. On German politicians and German bots it reached 0.76.
  - Precision and recall when the sample is resampled to a 15% bot rate:

    | Setting | Precision | Recall |
    |---|---|---|
    | Universal score > 0.76, full dataset | 0.59 (41% of flagged accounts were human) | 0.2 |
    | Universal score > 0.76, German set | 0.24 | 0.1 |
    | CAP > 0.25, full dataset | 0.55 | 0.29 |

  - Scores moved over time: 7.4% of German politicians crossed the 0.76 threshold at least once in 3 months.
  - Of 27 politicians falsely flagged, only 1 showed plausibly automated behaviour (cross-posting from Facebook).
  - [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0241045)
- **Gallwitz & Kreil (arXiv preprint, 2022).** They manually inspected hundreds of accounts that Botometer-based studies had counted as bots and say they could not find a single social bot. Their conclusion is that such studies mostly measure false positives. [PDF](https://arxiv.org/pdf/2207.11474). This is a preprint from vocal critics; credible in direction but adversarial in framing.
- **Hays et al. (WWW 2023), on dataset artifacts and shift.**
  - Very shallow decision trees match the state of the art: depth 1 gives 0.82 accuracy on TwiBot-20 (split on `verified`), 0.97 on midterm-2018 and 0.98 on cresci-2017.
  - Cross-dataset transfer is mostly near chance: leave-one-dataset-out balanced accuracy is 0.52–0.84, and TwiBot-20 held out gives 0.55.
  - Takeaway: high benchmark scores reflect how datasets were collected, not a stable difference between bots and humans.
  - [ar5iv 2301.07015](https://ar5iv.labs.arxiv.org/html/2301.07015)
- **LLM bots: fox8 (Yang & Menczer 2023/2024).**
  - 1,140 ChatGPT-driven crypto-promotion accounts, found through links to 3 shared sites and self-revealing phrases ("as an AI language model").
  - Botometer judged them human-like, with recall near zero. GPTZero scored them near 0.
  - The OpenAI classifier's account-level F1 was 0.84 on the labelled set. In a field test it flagged 815 of 1,986 random accounts, mostly false positives.
  - What did work was coordination: shared links, and the accounts replying to and retweeting each other.
  - [ar5iv 2307.16336](https://ar5iv.labs.arxiv.org/html/2307.16336)
- **"What Does the Bot Say?" (ACL 2024).** Instruction-tuned LLM detectors trained on about 1,000 labelled examples beat baselines by up to 9.1%. LLM-guided editing of profile and text cut existing detectors' performance by up to 29.6%. [ACL Anthology](https://aclanthology.org/2024.acl-long.196)
- **BotSim (AAAI 2025).** A simulated LLM-agent botnet dataset (BotSim-24). Detectors that worked on older bot datasets did worse on it. [AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/33575)
- **TRACE-Bot (arXiv, April 2026).** The authors report 98.46% and 97.50% accuracy on two LLM-bot datasets. Self-reported and not replicated. [arXiv 2604.02147](https://arxiv.org/abs/2604.02147)
- **OpenAI's text classifier.** Withdrawn on 2023-07-20 for low accuracy: 26% true-positive rate and 9% false-positive rate, and unreliable under 1,000 characters. These numbers come from secondary reporting; the primary page returned HTTP 403. [Decrypt](https://decrypt.co/149826/openai-quietly-shutters-its-ai-text-classifier-due-to-low-accuracy)

### X reply spam and engagement farming (secondary sources, platform statements only)

- X's head of product said in October 2025 that 1.7M bots "engaging in reply spam" were purged. [WION](https://www.wionews.com/technology/x-removed-over-1-7-million-bots-dm-spam-next-says-product-head-nikita-bier-1760344720045/amp)
- Creator payouts moved in November 2024 to engagement from Premium subscribers, which rewards provocative reply farming. [Scroll.in](https://scroll.in/article/1072706/there-is-a-reason-your-x-feed-has-turned-more-toxic-have-you-heard-of-engagement-farming)
- No peer-reviewed detector for reply-guy bots or AI slop was found.

### Inference

- There are several distinct targets that a single score should not merge:
  - declared automation (benign)
  - spam and fake followers (metadata catches these well)
  - sockpuppets and state trolls (human-run; metadata is weak and coordination is needed)
  - LLM persona bots (realistic profiles; metadata and text detectors both weak)
- For 2024–2026 LLM accounts, the strongest client-visible cues are:
  - a reply-only or reply-dominant timeline
  - very high reply volume
  - generic replies that fit any post
  - self-revealing phrases ("as an AI language model")
  - repeated link or crypto targets
  - template sameness across accounts

  None of these is validated as a feature with published accuracy.

## Platform-specific heuristics

| Platform | Confirmed (source) | Practitioner or unverified |
|---|---|---|
| X | Handle length and digits, bigram likelihood, friends growth, low favourites (Yang 2020). Declared bots carry an "Automated" label linked to a human account ([X Help](https://help.x.com/en/using-x/automated-account-labels)). "About this account" shows country inferred from IP, can be wrong with VPNs or travel, and users can show region instead (late 2025, [TechCrunch](https://techcrunch.com/?p=3070014)). | name+8 digits handles (X's default suggestion format, not verified); join-date clustering; replies-only timelines; recently bought blue check; crypto/porn bio templates; username-change count (one report, unverified: [Jordan News](https://www.jordannews.jo/Section-129/Technology/X-Platform-Tests-New-Feature-Revealing-Account-Country-45724)) |
| Instagram | Fake accounts: high following, few followers, no posts, digits in username, no profile picture. One example had 3,949 following and 15 followers (Akyon & Kalfaoglu, 1,002 real / 201 fake, [PDF](https://arxiv.org/pdf/1910.03090)) | Generic bio, stock-photo avatar, private + mass-follow |
| TikTok | The busiest posting accounts (1,500–6,000 posts/hour) all had the default handle `user` + 9 random digits. 831 accounts commented faster than once every 3 seconds, and 88% of their comments were emoji-only ([arXiv 2504.13279](https://arxiv.org/html/2504.13279)). TikTok and Twitter differ in how bot status relates to verification, following count and age ([PDF](https://arxiv.org/pdf/2301.08305)). | Following = 0 or followers = 0 with no videos |
| Reddit | No peer-reviewed metadata study found. | Reddit's suggested-name format is Adjective_Noun_1234 or Adjective-Noun-1234 (third-party description, [redship.io](https://redship.io/free-tools/reddit-username-generator)); many real users keep it, so it is weak on its own. Karma farming by reposting to reach subreddit karma minimums, then selling aged accounts (community wikis). Repost Sleuth claims 1M+ searches per day ([Patreon](https://www.patreon.com/repostsleuthbot/home)). |
| YouTube | Scam comments: 206K out of 8.8M comments (about 2.34%) from about 10K accounts. Evasion uses look-alike characters, abuse of account names, and splitting text across accounts (NDSS 2024, [paper](https://www.ndss-symposium.org/ndss-paper/like-comment-get-scammed-characterizing-comment-scams-on-media-platforms/)). 1,134 scam bots across 72 campaigns, present on 31.73% of crawled videos, with self-engagement to climb top comments (IMC 2023, [PDF](https://nss.kaist.ac.kr/assets/papers/imc2023-na.pdf)). | Channel with no videos commenting; auto-style `@user-xxxx` handles; profile image or name that mimics the video's creator |

## Calibration and UX wording

### Confirmed (Botometer 101, Yang/Ferrara/Menczer 2022, [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9391657))

- Raw scores are not probabilities. Since v3 the web scores were rescaled to 0–5 "to discourage inaccurate probabilistic interpretations".
- CAP is the probability that an account with a given score or higher is automated. It is meant for choosing a threshold, and it depends on the bot prevalence assumed.
- Validate thresholds and test several. In their case study, 0.5 and 0.7 led to different conclusions.
- A score is a snapshot in time. Content and sentiment features break for non-English accounts.
- Automated does not mean malicious. Calling people you disagree with "bots" is "a misuse of Botometer". Prefer wording like "likely automated" or "has a high bot score".

### Confirmed (2026 query-log study, [arXiv 2609.20661](https://arxiv.org/abs/2609.20661))

- Public bot suspicion spikes during platform crises.
- Accounts people check are older and more prolific than average, and often post political, promotional or crypto content.
- When people judge an account human, they cite first-person identity claims. When they judge it a bot, they cite posting rate, political content and coordination.

### Inference (product guidance)

- Show three tiers ("Looks typical / Some automation signals / Many automation signals") rather than a percentage, because no calibration data exists.
- Always show the top 2–4 contributing reasons, in neutral and factual form, for example "Joined 3 weeks ago · 140 posts/day · following 4,900, followers 12".
- Describe signals rather than the person: "account shows patterns common in automated accounts", never "this is a bot" or "fake". This also limits defamation-adjacent risk.
- Add a "why might this be wrong" line: new users, journalists, and high-volume posters such as news or brand accounts.
- Respect the platform's own "Automated" label as an override.

## Datasets and pretrained lightweight models

### Confirmed

- **BotArtist:** code at [GitHub](https://github.com/alexdrk14/BotArtist), licensed CC BY-NC-SA 4.0 (non-commercial). The trained model is "will upload" as a pickle, not yet released. It can be retrained from TwiBot-22 with their configuration. A dataset of 10,929,533 profiles with features and predictions is at [Zenodo](https://zenodo.org/records/11203900).
- **TwiBot-22 and its re-implemented baselines:** [twibot22.github.io](https://twibot22.github.io) (access is by application).
- **Bot Repository and Cresci datasets:** the Cresci 2015 baseline is research-use only ([SoBigData](https://ckan-sobigdata.d4science.org/dataset/twitter_fake_followers)).
- **Botometer X:** archival scores only, for data collected before June 2023. No accounts created after 2023-05-31 are covered, and there is no live scoring. A bulk API exists via RapidAPI. [OSoMe](https://osome.iu.edu/research/blog/introducing-botometer-x)
- **Hugging Face:** no maintained profile-feature bot model in ONNX or JSON was found. There is a pickle in a personal Space (BhavyaSoni21/Model2) and a RoBERTa text classifier (junaid1993/bot_detection_model), both unvetted. There is also a Korean YouTube bot-comment dataset under MIT licence ([MisileLab/youtube-bot-comments-v2](https://huggingface.co/datasets/MisileLab/youtube-bot-comments-v2)).

### Inference

- The training data is Twitter API v1.1-era. Fields such as `favourites_count`, `listed_count`, `default_profile` and `profile_use_background_image` are mostly not visible on today's X web profile. A distilled model would have to be retrained on the subset you can actually scrape.
- Given the Hays results, a model trained on these datasets may not beat hand-set rules on present-day populations.
- A model distilled to logistic regression or depth-3 trees is a few KB and runs trivially in JavaScript.

## Recommended features per platform, ranked by expected signal

These rankings are inferences built from the confirmed findings above.

1. **X**
   1. Posts per day of account age
   2. Following count combined with the followers/following ratio, when following is high
   3. Account age, especially under 90 days
   4. Handle shape: name+digits, more than 4 trailing digits, low bigram likelihood
   5. Share of replies in the visible timeline
   6. Repeated or generic reply text and crypto/link bio templates
   7. Default avatar and empty bio
   8. "About this account" country vs. the claimed locale (weak, error-prone)
   9. "Automated" label (decisive, toward declared bot)
2. **Instagram:** posts = 0 with following > 1,000; following/followers > 10; no profile picture; digits in the username; empty or generic bio; private with mass following.
3. **TikTok:** `user` + 9 digits default handle; 0 videos with any commenting; emoji-only or repeated comments; very high following count with followers near 0.
4. **Reddit:** account age vs. karma (fast karma on a new account, or an old dormant account suddenly active); post karma far above comment karma; reposted titles or images; default Adjective_Noun_#### name, weighted low, only useful in combination; links to the same domain.
5. **YouTube:** commenter channel with 0 videos and a new join date; name or avatar imitating the video creator; look-alike characters or "contact me on WhatsApp/Telegram" text; same text across multiple accounts on one video.

## Recommended scoring approach for an MVP with no labelled data

This is an inference.

- Use hand-tuned weighted log-odds heuristics: a naive-Bayes-style sum of capped per-feature contributions, passed through a logistic function, then bucketed into the 3 tiers.
- Use only directions and thresholds supported by the literature, and require at least 2 independent signals before the top tier.
- Do not present the number as a probability. Cresci 2015 shows naive rule lists give high precision and low recall; that is acceptable for an honest "many signals" tier but means most bots will read as "unclear".
- Log feature vectors and user feedback with consent from day one. Later, fit a logistic regression or depth-3 gradient-boosted trees per platform, and calibrate it with isotonic or Platt scaling on your own data.
- Do not ship a model trained on the TwiBot or Cresci datasets as the primary scorer, given the cross-dataset results.

## Gaps

- OpenAI classifier primary page (HTTP 403); the 26%/9% figures come from secondary reporting.
- Kudugunta's exact account-level feature list and classifier: the full text was not read.
- The exact accuracy of Instagram fake-account papers beyond Akyon: their numbers are self-reported.
- Reddit's own documentation of its generated-username format, and Reddit's profile-hiding feature (not checked).
- Whether X's profile still shows lists or likes counts, and which "About this account" fields have shipped. The username-change count is unconfirmed.
- YouTube auto-generated handle format (not checked).
- No peer-reviewed evaluation of detectors for reply-guy or AI-slop accounts on any of these platforms.
- Botometer X score scale (0–1 vs. 0–5): sources conflict.
- TwiBot-22 F1 for the graph neural network baselines: that part of the page was not read.

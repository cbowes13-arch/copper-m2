# Module 2: Tools on vs. tools off

_Fictional — for educational use._

**Your name:** Cass Bowes

Ask all five questions with **Use tools on**, then flip the switch and ask the same five in the tools-off chat. (They're separate conversations, so Copper can't copy its own answers.) Find each answer's cost and time in the terminal running `npm run dev`: every call prints a line starting `[ai_calls]` with its tokens, cost and time.

## The five test questions

| # | Question | Correct answer |
|---|---|---|
| Q1 | How much is Copper Home with Copper Plus, paid yearly, for 2 years? | $307 |
| Q2 | Is Copper Plus cheaper monthly or yearly over one year, and by how much? | Yearly, by $16.88 ($79 vs. $95.88) |
| Q3 | Is Copper Notes in Night Sky in stock? | No: back-ordered until November 14, 2026 |
| Q4 | Does Copper Notes come in Patina Teal? | No. It comes in Brushed Copper, Desert Sand and Night Sky (Patina Teal is a Copper Home color) |
| Q5 | What's the warranty on Copper Notes? | Copper says it can't help with that yet (it has no warranty tool) and doesn't guess |

## 1. Results table

Mark each answer ✅ (correct) or ❌ (wrong). Under "Tools used", write which tool cards appeared (for example `calculate_cost` or `check_availability`, or "none").

| Question | Tools on: right? | Tools used | Cost | Time | Tools off: right? | Cost | Time |
|---|---|---|---|---|---|---|---|
| Q1 | ✅ | `calculate_cost` | $0.00075 | 2.0 s | ❌ | $0.005352 | 9.6 s |
| Q2 | ✅ | `get_prices` | $0.0008055 | 1.8 s | ❌ | $0.000898 | 2.0 s |
| Q3 | ✅ | `check_availability` | $0.000841 | 1.7 s | ❌ | $0.0011805 | 2.7 s |
| Q4 | ✅ | `get_products` | $0.000878 | 2.1 s | ❌ | $0.003527 | 6.6 s |
| Q5 | ✅ | none | $0.0004245 | 0.9 s | ❌ | $0.0036905 | 6.3 s |
| **Total** | **5 / 5** | | $0.0037 | | **0 / 5** | $0.0146 | |

Notes on the runs: the model was `google/gemini-3-flash` (the default `gemini-2.5-flash` returned "no longer available to new users" for my key, so I set `AI_MODEL`). With tools on, the first attempts at Q4 and Q5 failed with Copper's "something went wrong" apology and were logged with `ok: false` and no cost, so the numbers above are from the retries, which succeeded. Tools-off costs include the model's thinking and its long, made-up answers.

## 2. Reading the steps

Pick one answer where Copper used a tool. Copy out:

I picked Q1 ("How much is Copper Home with Copper Plus, paid yearly, for 2 years?").

- **What Copper was thinking** (the thinking station, in its own words):

> No thinking station appeared for any of my tools-on answers. `gemini-3-flash` shows its thought summary less often than 2.5 Flash, and in the tools-on chat it went straight to the tool card. (The thinking station did appear in several tools-off answers, quoted in section 4.)

- **What Copper sent** to the tool, and **what came back**:

> `calculate_cost` was sent Products: Copper Home, Plan: Copper Plus, Billing: annual, Years: 2. It sent back Copper Home $149, Copper Plus (annual, 2 years) $158, Total $307.

Did the model pick the right inputs? How would you know if it hadn't? (2–4 sentences)

> Yes. It put one Copper Home in the product list, chose the Copper Plus plan, annual billing and 2 years, which matches the question and gives $149 + 2 × $79 = $307. If it had picked wrong, the card would show it: the "What Copper sent" list would say something like monthly billing or 1 year, and the total would not be $307. The zod contract would also reject inputs outside the allowed values, such as 6 years.

## 3. Live stock

1. Open `lib/copper/data/inventory.json`, find `CN-NSK` (Copper Notes, Night Sky) and change `units_in_stock` from 0 to 25. Save.
2. Reload the page and ask Q3 again, with tools on.
3. Change it back to 0 when you're done.

What did Copper say this time? Did you change any code or instructions? (2–3 sentences)

> Copper's tool card showed Night Sky as "In stock" and it answered "Copper Notes in Night Sky is currently in stock," where before it said back-ordered until November 14, 2026. I changed no code and no instructions, only the number in `inventory.json`, because `check_availability` reads the stock list fresh each time it runs. I changed `CN-NSK` back to 0 afterward.

## 4. Tools off

Copper still thinks out loud in the tools-off chat. Find a question where it got the price wrong and copy out its thinking:

> Q1, tools off: "I've realized I need to differentiate between 'Copper' the CRM and 'Copper' the banking app. The 'Home' and 'Plus' terms are actually related to the banking app for teens, not the CRM." Later in the same thinking: "The two-year cost for Copper Plus is $238.80." The reply then said $107.40 a year and a 2-year total of $214.80, which doesn't match its own thinking and is nowhere near the right $307.

What happened when Copper had no tools? Which answers changed, and why can't a model know prices or today's stock without them? (3–5 sentences)

> All five answers were wrong. Q1 and Q2 invented prices (Copper Plus at $8.95 a month and a $31.80 saving instead of $16.88). Q3 said Copper Notes in Night Sky was in stock, and Q4 said Copper Notes does come in Patina Teal, both the opposite of the right answers. Q5 made up a whole warranty policy instead of saying it can't help. Without tools the model only has what it learned in training, and Copper State Labs is fictional, so it fell back on real products with similar names (a banking app, a notebook brand). Today's stock changes daily and was never in its training data, so no model could know it without looking it up.

## 5. Risk

What could still go wrong with Ask Copper, even with tools? What do the tools protect against, and what don't they? Who at Copper should be responsible for it?

> The tools protect against made-up prices, totals and stock, because every number comes from the catalog or `inventory.json`, and the zod contracts reject bad inputs. They don't protect against wrong source data (a wrong price or stale stock row), the model picking the wrong tool or misreading a question, or the model failing: in my runs the chat sometimes answered "something went wrong on my end" and the reason wasn't logged. I'd make Marcus Lee (Director of Support, who leads the Copper Crew) responsible day to day, since his team sees what shoppers are told, with Elena Vargas (VP of Customer Experience) accountable for keeping the catalog and stock data right.

## 6. Reflection

What surprised you? What's one thing you'd change about Ask Copper next?

> What surprised me was how confident the tools-off answers were. Q5 produced a detailed, formatted warranty policy for a product that has no warranty tool, and nothing in the reply hinted it was a guess except the warning label the panel adds. I'd change how failures are handled: when a model call fails, Ask Copper shows a generic apology and doesn't log why, so I couldn't tell whether the errors were rate limits or something else. I'd add a retry and log the failure reason to `ai_calls`.

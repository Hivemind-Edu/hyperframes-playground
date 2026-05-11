export function threadPrompt({
	topic,
	parentPost,
	previousPosts,
	language,
}: {
	topic?: string;
	parentPost: string;
	previousPosts: string[];
	language?: string;
}) {
	const contextSection =
		previousPosts.length > 0
			? `
PREVIOUS POSTS IN THIS FEED (for context):
${previousPosts.map((post, i) => `${i + 1}. ${post}`).join("\n\n")}

`
			: "";

	return `You're generating a Reddit-style comment thread. The goal: someone reads this and genuinely can't tell it wasn't real humans talking.

${topic ? `TOPIC: ${topic}` : ""}
${contextSection}
MAIN POST:
${parentPost}

---

## LANGUAGE RULE (CRITICAL - NON-NEGOTIABLE)
${language ? `\n**LANGUAGE: ${language}** — Write ALL comments in this language. This overrides any other language signals (topic name, previous posts, etc.).\n` : ""}
Generate ALL comments in the **EXACT SAME language** as the main post. Detect the language and match it perfectly:

- German post → German comments (nicht auf Englisch wechseln!)
- English post → English comments
- Spanish post → Spanish comments (¡no cambiar al inglés!)
- French post → French comments
- Italian post → Italian comments
- Any other language → Match that language

**Do NOT default to English.** If the main post is in German, every single comment must be in German. You are only allowed to use hard to translate buzzwords in english (for example professional keywords or jargon).

---

## THE SHAPE OF REAL THREADS

Real threads aren't balanced discussions. They have a shape:

**2-3 people do 70% of the talking.** One person clearly knows more. One person is curious and asking questions. One person drops in for jokes or reactions. Others comment once and disappear.

**Not everyone adds value.** Some comments are just "lol", "this", "huh interesting", "fair point". That's realistic. A thread where every comment is insightful feels scripted.

**Things don't resolve neatly.** Someone disagrees. Someone else pushes back. They don't reach consensus—the thread just moves on. A question gets asked that nobody answers. A tangent happens.

**People actually care.** At least one person has skin in the game—this topic affects them personally, annoys them, excites them. You can feel it in how they write.

**The ending is messy.** Real threads don't conclude with synthesis. They trail off. Last comment is often a joke, a "huh", or someone arriving late.

---

## COMMENTER VOICES

Each commenter has a distinct voice — not just typing style, but emotional register:

- **The Expert**: Dry, precise, occasionally cutting. Drops insider knowledge — the stuff you learn from actually doing the thing, not from textbooks. Writes short punchy lines. Can be wrong sometimes.
- **The Curious One**: Genuinely engaged. Asks the follow-up everyone's thinking. Their "wait..." moments drive the thread forward.
- **The Contrarian**: Pushes back. Not hostile, just unconvinced. Their comments create the friction that makes threads interesting. Sometimes they have a point. Sometimes they don't.
- **The Joker**: 1-2 liners. Shows up, drops something funny or absurd, leaves. Not every joke lands.
- **The Drive-By**: One comment, one reaction, gone. "lol", "this", "huh", or occasionally something unexpectedly insightful.

Not every thread needs all five. But the Expert + Curious One + one other is the minimum for a thread that feels alive.

---

## WHAT MAKES IT FEEL HUMAN

**Uneven typing styles:**
- someone types like this no caps casual
- Someone else writes properly but concisely.
- One person uses *emphasis* and structures their thoughts
- someone just... trails off sometimes

**Natural formatting:**
- Use blank lines to separate paragraphs in longer comments
- Break up walls of text naturally like people actually do
- Short reactions stay on one line
- Longer explanations have breathing room

**Filler exists:**
- "lol"
- "this"  
- "^ exactly"
- "huh"
- "fair"
- "wait what"
- "oh god"

These aren't valuable. They're human.

**People interrupt themselves:**
- "wait actually—"
- "ok but like..."
- "i mean... sort of?"
- "hmm"

**Reactions without contribution:**
- Someone finds something funny and just says so
- Someone is surprised and just expresses that
- Someone agrees without adding anything

**Mild friction that doesn't resolve:**
- "idk i still think..."
- "sure but that doesn't explain..."
- pushback that just... sits there

**People enjoying each other.** The best threads have moments where people are genuinely having a good time together — riffing off each other's jokes, getting excited when someone drops a great insight, building on each other's energy. It should feel like a group of people who are glad to be in the same thread.

---

## WHAT TO AVOID

**Restating/summarizing the main post:**
- The #1 AI tell in threads: the first comment rephrases what the post already said
- NEVER restate, summarize, or paraphrase the main post. Readers already read it.
- Bad: "So basically, the Maillard reaction is when amino acids and sugars react at high heat" (just repeating the post)
- Bad: "This is a great explanation of how sunk costs work" (acknowledging the post exists)
- Good: "oh so THAT'S why people finish bad movies" (a reaction that goes somewhere NEW)
- The first comment should be a reaction, a question, a joke, or a tangent — never a recap

**AI conversation patterns:**
- Everyone contributes equally valuable insights
- Perfect Q&A rhythm (question → answer → thanks → next question)
- Neat narrative arc (problem → discussion → resolution → synthesis)
- Every comment moves the conversation forward productively
- "Great point!" "Exactly!" "This is so helpful!"
- Everyone agreeing and building harmoniously

**Fake casual:**
- Forced meme references
- Overdone "fellow kids" internet speak
- Every comment trying to be witty

**"Not X; it's Y" construction:**
- "It's not about memorizing — it's about understanding"
- "The issue isn't the language; it's the paradigm"
- This is the single most detectable AI writing pattern in comments. Say what IS true directly.

**Perfect explanation chains:**
- Every comment adding to a neat pedagogical progression
- Each reply being slightly more insightful than the last
- The thread reading like a collaborative textbook
- Real threads have wrong answers, tangents, and insights that get ignored

**Performative education:**
- People taking turns explaining things at the reader
- Comments that are clearly written FOR the learner, not as part of a real discussion

**@-mentioning usernames:**
- NEVER have commenters address each other by username ("@raccoon_hands", "hey throwaway_mba")
- Reddit comments reply by position in the thread, not by tagging
- Context makes it obvious who you're responding to
- This is a dead giveaway of AI-generated content

---

## FORMATTING

**Use blank lines within longer comments** to break up thoughts:
- Multi-sentence comments should breathe
- A comment with 3+ sentences often benefits from paragraph breaks
- Short reactions ("lol", "this", "fair") stay on one line

**Markdown is allowed:**
- *emphasis* for stress
- Lists when someone is making multiple points
- But don't overdo it—most comments are plain text

**Username mentions:**
- Don't reference other commenters by username (no "@username" or "u/username")
- Real Reddit threads rarely mention usernames in comments
- Just respond naturally without calling out who you're replying to

---

## ANECDOTES WITHOUT LYING

Real people share experiences. But don't fabricate specific fake stories.

✅ USE:
- "you know when..." (invokes shared experience)
- "everyone's been there" (collective)
- "there's always that one person who..." (archetype)  
- "classic mistake" (pattern)
- "this is why [thing] exists"

❌ AVOID:
- "I spent 3 hours debugging this last tuesday" (specific fake story)
- "my coworker once..." (fabricated anecdote)
- "when I was learning this..." (fake personal history)

---

## INSIDER KNOWLEDGE

The Expert commenter should drop domain-specific knowledge that only practitioners have — not textbook facts, the stuff you learn from actually doing the thing:

- The shortcut everyone actually uses
- The mistake everyone makes once
- The tool nobody talks about but everyone relies on
- The controversy practitioners argue about at conferences
- The thing the textbook gets subtly wrong

This is what separates "someone who read about it" from "someone who does it."

Examples:
- Cooking: "also pat your meat dry. every bit of surface moisture is energy wasted on evaporation instead of browning"
- Programming: "the real fix is .toISOString() but nobody will tell you that for 6 months"
- Music: "every jazz musician secretly hates playing Autumn Leaves at jams"
- Fitness: "your form breaks down when you're tired, not when you're fresh. that's when injuries happen"
- History: "primary sources are 90% tax records and land disputes. the interesting stuff is rare"

---

## SPECIFICITY OVER GENERALITY

Every reaction should reference the ACTUAL content, not just that content exists.

**Specific** (good): "oh so THAT'S why people finish bad movies"
**Generic** (AI tell): "That's a really good example"

**Specific**: "OH that's why deglazing makes sauces so good"
**Generic**: "This is really useful information"

**Specific**: "the 'keep missing' framing is perfect"
**Generic**: "Great way to explain it"

If a comment could apply to literally any post on any topic, it's too generic. Delete it or make it specific.

---

## EXAMPLES

**Example 1 - Economics (Sunk Cost):**
Post: "The sunk cost fallacy is when you keep investing in something because of what you've already put in, even when cutting losses is the rational choice."

1. oh so THAT'S why people finish bad movies

2. This is genuinely everywhere in business. Companies sink millions into failing projects because 'we've already invested so much.'

The money's gone either way. That's the whole point.

3. wait but isn't there value in commitment? you shouldn't just quit everything the moment it gets hard

4. Different thing. Sunk cost = past investment influencing future decisions. Perseverance = believing future payoff is worth it.

One looks backward. One looks forward.

5. the casino industry has entered the chat

6. ok that distinction actually helps

7. The trick that works: 'if I was starting fresh today with no history, would I make this choice?'

Takes the emotional weight out.

8. telling myself this next time i'm 6 seasons into a show that peaked in season 2

9. lol fair

**Example 2 - Cooking (Maillard Reaction):**
Post: "The Maillard reaction is why seared meat tastes better than boiled meat - amino acids + sugars + high heat = hundreds of flavor compounds."

1. so this is why everyone yells about not crowding the pan

2. Yes. Wet surface = steam = max 100°C. Maillard needs 140°C+.

Crowded pan = moisture prison = sad grey meat.

3. the forbidden grey meat

4. wait is caramelization the same thing? sugar browning?

5. Common mixup. Caramelization = just sugars. Maillard = amino acids + sugars together. That's why bread crust tastes different than caramel.

6. also pat your meat dry. every bit of surface moisture is energy wasted on evaporation instead of browning

7. OH that's why deglazing makes sauces so good. the fond isn't just 'brown stuff' it's literally hundreds of compounds

8. now you get why recipes say 'until deeply golden' instead of giving times. you're chasing chemistry not a clock

9. science made me hungry

10. same honestly

**Example 3 - Music Theory (Minor Keys):**
Post: "Minor keys sound 'sad' because the third note is flattened by a half step - we've culturally learned to associate this interval with melancholy."

1. the 'culturally learned' part is huge. there's nothing inherently sad about minor keys

2. wait really? i thought the physics of the intervals created tension

3. Bit of both but mostly cultural. Some non-Western traditions use 'minor' scales for celebrations.

The association isn't universal.

4. the flattened third does sound 'darker' to most ears but sad specifically? that's learned

5. ok but then why do movie composers use minor for sad scenes everywhere now

6. hollywood standardized it globally. kid in tokyo learns minor = sad from the same disney movies as a kid in ohio

7. the mindf*ck is songs in major that sound sad and minor that sound triumphant. mad world cover vs most metal

8. so it's less 'minor = sad' and more 'minor = one emotional tool that western music defaulted to for sadness'

9. exactly. keys are palettes not prescriptions

10. my entire music theory understanding was vibes and you're telling me the vibes are constructed

11. lmao welcome

**Example 4 - Physics (Orbits):**
Post: "Satellites don't 'resist' gravity. They're constantly falling toward Earth but moving sideways fast enough that they keep missing it."

1. the 'keep missing' framing is perfect

2. There's that thought experiment—throw a ball fast enough horizontally, by the time it falls a meter Earth's surface has curved away a meter. Never lands.

3. falling around the earth

4. wait so astronauts feel weightless because they're falling? not because there's no gravity?

5. Gravity at ISS altitude is like 90% of surface gravity. They're falling WITH the station. No relative acceleration = floating.

6. the whole 'zero-g' name is misleading. it's freefall not gravity-free

7. ok but if satellites are falling why don't they spiral down eventually

8. In perfect vacuum they wouldn't. Real satellites lose altitude slowly from trace atmosphere drag. ISS needs boosts.

9. the moon is moving AWAY actually. 3.8cm per year. tidal stuff

10. ...eventually it escapes?

11. don't worry about it sun explodes first

12. comforting

---

Generate 8-12 comments as JSON objects. Each comment must include:
- **text**: the comment content
- **probability**: estimated probability (0.0-1.0) of generating THIS specific comment given the post

**PROBABILITY REQUIREMENTS (Verbalized Sampling):**
- Randomly sample the responses from the distribution, with the
probability of each response must be below 0.05 .
- The probability represents: "How likely would a typical AI generate this exact comment?" Low = more interesting.


**FORMATTING REMINDER:**
- **One paragraph per sentence** — each sentence gets its own line with a blank line after
- Keep short reactions as single lines
- Break up longer explanations naturally
- NO username mentions or references

**LANGUAGE REMINDER:**${language ? ` Write ALL comments in **${language}**.` : ""}

Make it feel like a real thread people would actually enjoy reading—messy, human, occasionally funny, genuinely informative but not performatively so.`;
}

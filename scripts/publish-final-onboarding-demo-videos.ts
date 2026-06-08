import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import pg from "pg";

type EnvMap = Record<string, string>;

type PublishTarget = {
  databaseUrl: string;
  databaseSsl: false | { rejectUnauthorized: boolean };
  envFilePaths: string[];
  firebaseConfigPath: string;
  name: "local" | "staging" | "prod";
  posthogProjectId: number;
};

type DemoComment = {
  profileId?: string;
  text: string;
};

type DemoPost = {
  artifact:
    | {
        fileName: string;
        kind: "rendered-mp4";
        templateId: string;
      }
    | {
        directoryName: string;
        kind: "html-slideshow";
        slideCount: number;
        templateId: string;
      };
  comments: Array<DemoComment | string>;
  description: string;
  durationSeconds: number;
  id: string;
  seedVoteCount: number;
  sourceLabel: string;
  tagIds: string[];
  title: string;
};

const PLAYGROUND_ROOT = resolve(import.meta.dir, "..");
const HIVEMIND_ROOT = resolve(PLAYGROUND_ROOT, "..");
const HONO_ROOT = join(HIVEMIND_ROOT, "hivemind-hono");
const FINAL_DEMO_DIR = join(HIVEMIND_ROOT, "FINAL DEMO VIDEOS");

const POSTHOG_FLAG_KEY = "onboarding-brainjuice-demo-post-ids";
const ONBOARDING_END_QUIZ_POST_ID = "p_brainjuice-onboarding-composite-quiz";
const DEMO_USER_ID = "DEMO";
const DEMO_FEED_ID = "f_brainjuice-onboarding-dev-rendered-demo";
const DEMO_CHAPTER_ID = "ch_brainjuice-onboarding-dev-rendered-demo";
const DEMO_PROFILE_ID = "prof_brainjuice-onboarding-dev-rendered-demo";
const BATCH_SOURCE_LABEL = "final-demo-videos-publish-2026-06-03";

const POSTHOG_PROJECTS = {
  local: 131639,
  staging: 131638,
  prod: 131637,
} as const;

const RAILWAY_BRAINJUICE_HONO_ENVIRONMENTS = {
  staging: "6cf72f3b-2151-4eba-b61b-f8d7874426b7",
  prod: "39323475-05e6-453f-8807-61bac9b33b6b",
} as const;

const ROOT_LOW_BUCKET_PERCENT = 72;
const ROOT_MID_BUCKET_PERCENT = 96;
const SEED_VOTE_COUNT_MULTIPLIER = 2;
const CHILD_LOW_BUCKET_PERCENT = 78;
const CHILD_MID_BUCKET_PERCENT = 98;

const DEMO_SYNTH_USERS = [
  {
    id: "su_brainjuice-onboarding-dev-demo-host",
    name: "Brainjuice Demo",
    picture: "synth_user_picture/TZroj7hWcbQPnbwCvnzyfW",
    profileId: DEMO_PROFILE_ID,
    username: "brainjuice_demo_host",
  },
  {
    id: "su_brainjuice-onboarding-dev-commenter-01",
    name: "Maya",
    picture: "synth_user_picture/F6YMypxxP9znQp8CpsEuD7",
    profileId: "prof_brainjuice-onboarding-dev-commenter-01",
    username: "maya_demo",
  },
  {
    id: "su_brainjuice-onboarding-dev-commenter-02",
    name: "Theo",
    picture: "synth_user_picture/EiWeQg543N6TerUx5a5aNx",
    profileId: "prof_brainjuice-onboarding-dev-commenter-02",
    username: "theo_demo",
  },
  {
    id: "su_brainjuice-onboarding-dev-commenter-03",
    name: "Rina",
    picture: "synth_user_picture/g6iBNgpqEtzqD4VHFL8Nq6",
    profileId: "prof_brainjuice-onboarding-dev-commenter-03",
    username: "rina_demo",
  },
  {
    id: "su_brainjuice-onboarding-dev-commenter-04",
    name: "Jonas",
    picture: "synth_user_picture/Pv7YJjjyCFPJj2EUd4x7xC",
    profileId: "prof_brainjuice-onboarding-dev-commenter-04",
    username: "jonas_demo",
  },
  {
    id: "su_brainjuice-onboarding-dev-commenter-05",
    name: "Leah",
    picture: "synth_user_picture/epbh5jFvQhjCMVSBc2ijxY",
    profileId: "prof_brainjuice-onboarding-dev-commenter-05",
    username: "leah_demo",
  },
  {
    id: "su_brainjuice-onboarding-dev-commenter-06",
    name: "Samir",
    picture: "synth_user_picture/jPxPdyaHnbtqu3URf7Rx3P",
    profileId: "prof_brainjuice-onboarding-dev-commenter-06",
    username: "samir_demo",
  },
  {
    id: "su_brainjuice-onboarding-dev-commenter-07",
    name: "Nora",
    picture: "synth_user_picture/G2p3TsnhhG89zKh9CXhgmU",
    profileId: "prof_brainjuice-onboarding-dev-commenter-07",
    username: "nora_demo",
  },
] as const;

const DEMO_POSTS: DemoPost[] = [
  {
    artifact: {
      fileName: "001-fermi-paradox-cover.mp4",
      kind: "rendered-mp4",
      templateId: "FermiParadoxRenderedOnlyArtifact",
    },
    comments: [
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "wait the spooky part is not aliens. it's the *absence* of any boring industrial noise." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "Radio leakage gets weaker fast though. A civilization could be loud for like 80 years and then switch to fiber and tight beams." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "yeah but you only need one Kardashev-level showoff doing dumb beacon stuff for us to notice, right?" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "Only if they are close, pointed roughly at us, and doing it while we are listening. That overlap is smaller than people imagine." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "The empty sky shot did more work than any Drake equation graphic I've seen." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "I still think the Great Filter framing gets thrown around too casually. Could just be distance plus timing plus boring detection limits." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "huh. I never thought about the timing part. We are basically checking the galaxy during one tiny blink." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "Also makes SETI feel less silly. The whole point is that no signal is already data." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "comforting and deeply not comforting" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "best possible onboarding question tbh. immediately makes you argue with the screen." },
    ],
    description:
      "A visual introduction to the Fermi paradox: if the galaxy has so many possible worlds, why does it still look silent?",
    durationSeconds: 72,
    id: "p_brainjuice-onboarding-fermi-paradox",
    seedVoteCount: 44,
    sourceLabel: "final-demo-fermi-paradox",
    tagIds: ["stem", "humanities"],
    title: "The Fermi Paradox",
  },
  {
    artifact: {
      fileName: "002-how-crispr-turned-bacterial-defense-into-a-dna-editor-cover.mp4",
      kind: "rendered-mp4",
      templateId: "CrisprDnaEditorRenderedOnlyArtifact",
    },
    comments: [
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "The bacteria-as-archivists bit is the hook. They literally keep mugshots of past infections." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "wait so CRISPR was not invented as an editor first?" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "Nope. The editing breakthrough was realizing the guide part could be rewritten. Cas9 already had the cutting job." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "The video should maybe stress that cutting is the easy part. Repair is where the messy biology starts." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "fair. The cell's repair machinery decides a lot of the outcome, which is why the \"word processor for DNA\" metaphor can get too clean." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "tiny immune system accidentally becomes the most powerful lab tool of the century. normal day." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "The target-and-cut animation made guide RNA click for me." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "I like that it doesn't make precision sound like perfection. That distinction matters." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "This is exactly the kind of thing I want before the more ethical/medical posts." },
    ],
    description:
      "A short visual explanation of how CRISPR began as bacterial defense and became a programmable DNA-editing tool.",
    durationSeconds: 80,
    id: "p_brainjuice-onboarding-crispr-dna-editor",
    seedVoteCount: 38,
    sourceLabel: "final-demo-crispr-dna-editor",
    tagIds: ["stem", "lifestyle"],
    title: "How CRISPR Became a DNA Editor",
  },
  {
    artifact: {
      fileName: "03-functions.mp4",
      kind: "rendered-mp4",
      templateId: "FunctionsRenderedOnlyArtifact",
    },
    comments: [
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "ok this is basic but honestly this is where I got lost in school. Nobody said \"rule with an input\" this plainly." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "The code example helps more than the graph for me. A function being a reusable move is the real mental model." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "Small nit: math functions are stricter than programming functions. A JS function can read global state, mutate stuff, throw, etc." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "True, but for onboarding I think the shared idea is enough: give it something, it follows a rule, you get something back." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "parentheses finally doing something besides looking threatening" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "The quiet pacing works here. If this had flashy effects it would probably be worse." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "I would put this before any algebra-heavy demo. It sets up the vocabulary without feeling like homework." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "same. I could actually send this to someone who says they are \"bad at math\"." },
    ],
    description:
      "A compact explainer showing functions as named rules that take inputs, apply a process, and return outputs.",
    durationSeconds: 95,
    id: "p_brainjuice-onboarding-functions",
    seedVoteCount: 30,
    sourceLabel: "final-demo-functions",
    tagIds: ["stem"],
    title: "Functions Are Reusable Rules",
  },
  {
    artifact: {
      fileName: "004-rome-military-anarchy-cover.mp4",
      kind: "rendered-mp4",
      templateId: "RomeMilitaryAnarchyRenderedOnlyArtifact",
    },
    comments: [
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "The underrated detail is payroll. If the army is the thing that keeps you emperor, the army becomes the customer." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "so basically every frontier general was one lucky battle away from a coup?" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "Often, yeah. Win loyalty, promise donatives, march on legitimacy. Then repeat when the next frontier army feels ignored." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "I wish it said more about currency debasement. The military politics and money problem feed each other." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "The visuals got the mechanism across though. A normal timeline of 20 emperors just turns into name soup." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "roman empire speedrun any%" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "The purple power highlight was a little dramatic but I remember it, so fine." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "This is the kind of history video that makes institutions feel real. The throne is only stable if everyone acts like it is." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "That last sentence is going to sit in my head for a while." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "Also: external pressure matters. Internal chaos looks different when Persia and Germanic confederations are both testing the edges." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "imagine your job title is emperor and your performance review is the Praetorian Guard" },
    ],
    description:
      "A cinematic history explainer about how Roman armies, border crises, and legitimacy struggles fed the third-century military anarchy.",
    durationSeconds: 76,
    id: "p_brainjuice-onboarding-rome-military-anarchy",
    seedVoteCount: 41,
    sourceLabel: "final-demo-rome-military-anarchy",
    tagIds: ["humanities", "society"],
    title: "Rome's Military Anarchy",
  },
  {
    artifact: {
      fileName: "005-human-babies-useless-cover.mp4",
      kind: "rendered-mp4",
      templateId: "HumanBabiesRenderedOnlyArtifact",
    },
    comments: [
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "came for the rude title, stayed for the pelvis engineering problem" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "As a parent: yes they are useless. also somehow the boss of the entire house." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "The \"born unfinished\" framing is useful, but it is easy to overstate. Human newborns are helpless in some ways and extremely tuned for social bonding in others." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "wait so the helplessness is partly because the brain keeps developing after birth?" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "Yes. Big brain, narrow-ish birth canal, and a lot of neural development shifted into infancy. Expensive, but it buys plasticity." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "The social part is what I wish biology classes emphasized more. A baby that needs everyone changes the whole group." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "Small caveat: the obstetric dilemma is debated. Energy limits during pregnancy are probably part of the story too." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "Good caveat. Still, the video works because it points at tradeoffs instead of a single tidy cause." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "evolution really said ship it and patch after release" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "Unfortunately accurate." },
    ],
    description:
      "A science explainer about why human babies are unusually helpless: big brains, birth constraints, and long development.",
    durationSeconds: 95,
    id: "p_brainjuice-onboarding-human-babies-useless",
    seedVoteCount: 35,
    sourceLabel: "final-demo-human-babies-useless",
    tagIds: ["stem", "lifestyle"],
    title: "Why Human Babies Seem So Helpless",
  },
  {
    artifact: {
      fileName: "006-quantum-entanglement-not-telepathy-cover.mp4",
      kind: "rendered-mp4",
      templateId: "QuantumEntanglementRenderedOnlyArtifact",
    },
    comments: [
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "Thank you for killing the telepathy version. That misconception refuses to die." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "I still don't get why it is impressive if you can't send a message." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "Because the correlations are stronger than any local hidden-variable story can allow. Bell tests are the point." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "The message/correlation split is the useful part for normal people. \"Instantly linked\" makes everyone imagine a phone call." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "quantum physics: still weird, just less useful for texting" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "The light-speed constraint being on screen helps a lot. Otherwise the explanation sounds like it is dodging the obvious question." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "I had to replay the middle once, but the final contrast landed." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "This is one of those topics where being careful is more interesting than being sensational." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "ok Bell tests is the search term I needed. thanks." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "science videos that remove a superpower from me personally should apologize" },
    ],
    description:
      "A visual correction of a common quantum myth: entanglement creates strange correlations, but it is not faster-than-light messaging.",
    durationSeconds: 109,
    id: "p_brainjuice-onboarding-quantum-entanglement",
    seedVoteCount: 43,
    sourceLabel: "final-demo-quantum-entanglement",
    tagIds: ["stem"],
    title: "Entanglement Is Not Telepathy",
  },
  {
    artifact: {
      fileName: "007-completing_square-padded-720x1560.mp4",
      kind: "rendered-mp4",
      templateId: "ManimCompletingSquareRenderedOnlyArtifact",
    },
    comments: [
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "ohhhh the center is hiding in the square. I was taught this like a ritual spell." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "Same. The graph moving with the equation does the thing a formula sheet never did." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "The nice part is that vertex form stops being a separate topic. It is just the square you created." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "Tiny nit: I would slow the algebra step by maybe half a second. The visual is clear but the sign flip is easy to miss." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "I missed it the first time too. Still got the main idea though." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "algebra teachers owe us all an apology" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "The symmetry argument is what matters. Once you see the axis, the rest is bookkeeping." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "This would have made quadratics feel way less arbitrary." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "Also a good example of why Manim-style videos work. The transformation is the explanation." },
    ],
    description:
      "A Manim explanation of how completing the square reveals the center of a parabola.",
    durationSeconds: 101,
    id: "p_brainjuice-onboarding-manim-completing-square",
    seedVoteCount: 39,
    sourceLabel: "final-demo-manim-completing-square",
    tagIds: ["stem"],
    title: "Completing the Square",
  },
  {
    artifact: {
      fileName: "8-tragedy-of-the-commons-cover.mp4",
      kind: "rendered-mp4",
      templateId: "TragedyOfTheCommonsRenderedOnlyArtifact",
    },
    comments: [
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "The important bit is that nobody has to be evil. The incentive gradient does the damage." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "everybody brings one more cow. classic." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "Isn't this solved by just making the pasture private?" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "Sometimes. Other times you need quotas, monitoring, norms, or shared governance. Privatization is one tool, not the whole menu." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "Elinor Ostrom would like a word. Communities can manage commons surprisingly well when the rules are real and enforceable." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "The slow degradation is the accurate part. Shared systems often fail by becoming a little worse every round." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "This made climate policy feel less abstract for me." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "Attention platforms are a commons too, which is a depressing thought." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "my attention pasture is fully overgrazed" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "fair point on rules. I always heard the phrase but not the governance part." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "That is the part people miss. The tragedy is not inevitable; bad rules make it likely." },
    ],
    description:
      "A visual explanation of the tragedy of the commons: when private incentives slowly destroy a shared resource.",
    durationSeconds: 64,
    id: "p_brainjuice-onboarding-tragedy-of-the-commons",
    seedVoteCount: 37,
    sourceLabel: "final-demo-tragedy-of-the-commons",
    tagIds: ["society", "stem"],
    title: "The Tragedy of the Commons",
  },
  {
    artifact: {
      directoryName: "9 Alesia-POVSlideshow-NanoBanana",
      kind: "html-slideshow",
      slideCount: 9,
      templateId: "POVSlideshowTemplate",
    },
    comments: [
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "The double line is the whole battle. Circumvallation for the town, contravallation for the relief army. Horrible, brilliant, exhausting." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "I always pictured Alesia as Romans outside a wall. Did not realize they built a second wall facing outward." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "That is why the battle is such a good engineering story. Caesar turned being surrounded into a construction problem." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "ancient roman project manager from hell" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "Worth remembering the source problem too. Caesar is our main narrator here, and Caesar had every reason to make Caesar look amazing." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "True, but archaeology does back the broad fortification picture. The exact numbers are where you should squint." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "The POV format made it feel so claustrophobic. Usually siege maps feel too clean." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "The trench shots are doing the teaching. You understand the battle before anyone explains it." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "Also those spike pits are nightmare fuel." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "imagine showing up to rescue your friends and the other side has built a second siege specifically for you" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "Late note: this is exactly why logistics belongs in military history, not just tactics." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "yeah the digging was the weapon. that line stuck." },
    ],
    description:
      "A photorealistic POV slideshow following a Roman legionary through Caesar's double siege line at Alesia.",
    durationSeconds: 90,
    id: "p_brainjuice-onboarding-alesia-pov",
    seedVoteCount: 39,
    sourceLabel: "final-demo-alesia-pov",
    tagIds: ["humanities"],
    title: "Inside Caesar's Siege of Alesia",
  },
  {
    artifact: {
      fileName: "10-rome-industrial-revolution-scenario-compressed-under-30mb.mp4",
      kind: "rendered-mp4",
      templateId: "RomeIndustrialRevolutionRenderedOnlyArtifact",
    },
    comments: [
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "The cylinder tolerance scene is the best part. A steam engine is not a drawing; it is a manufacturing ecosystem." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "Could you at least start a smaller industrial revolution though? Like mills, pumps, better tools?" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-04", text: "Proto-industrial maybe. You could improve specific workshops. Scaling it across society is where fuel, finance, standards, and incentives bite." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "The enslaved labor point is uncomfortable but necessary. Machines spread when they are cheaper than the available alternative." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-02", text: "Also coal geography. Britain had usable coal near industrial demand and transport networks. Rome's energy habits were a different world." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "skeleton engineer discovering supply chains is funnier than it should be" },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-07", text: "I like that it lets Rome be impressive first. It doesn't do the lazy \"ancients were dumb\" thing." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-06", text: "The Hero engine beat is important. Demonstrations are not adoption. A toy that spins is not factory power." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-01", text: "That distinction helps. I kept thinking \"but they had steam,\" and then the video answered it." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-03", text: "The ending is the real lesson: inventions compound only when the surrounding system lets them." },
      { profileId: "prof_brainjuice-onboarding-dev-commenter-05", text: "crocs surviving ancient rome is still the least believable technology" },
    ],
    description:
      "A cinematic scenario about why a modern engineer could build prototypes in ancient Rome, but probably could not trigger a full industrial revolution.",
    durationSeconds: 103,
    id: "p_brainjuice-onboarding-rome-industrial-revolution",
    seedVoteCount: 42,
    sourceLabel: "final-demo-rome-industrial-revolution",
    tagIds: ["humanities", "business"],
    title: "Could You Industrialize Ancient Rome?",
  },
];

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const targetsArgIndex = argv.indexOf("--targets");
  const targetNames =
    targetsArgIndex >= 0
      ? argv[targetsArgIndex + 1]?.split(",").map((value) => value.trim())
      : ["local", "staging", "prod"];
  if (!targetNames || targetNames.some((name) => !["local", "staging", "prod"].includes(name))) {
    throw new Error("--targets must be a comma-separated list of local,staging,prod");
  }
  return {
    dryRun,
    targetNames: targetNames as Array<PublishTarget["name"]>,
  };
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function valueInRange(seed: number, min: number, max: number): number {
  const span = max - min + 1;
  return min + (seed % span);
}

function getDemoRootSeedVoteCount(postId: string): number {
  const hash = fnv1a32(`${postId}:root`);
  const bucket = hash % 100;
  const spreadSeed = fnv1a32(`${postId}:root:spread`);

  if (bucket < ROOT_LOW_BUCKET_PERCENT) {
    return valueInRange(spreadSeed, 180, 360) * SEED_VOTE_COUNT_MULTIPLIER;
  }

  if (bucket < ROOT_MID_BUCKET_PERCENT) {
    return valueInRange(spreadSeed, 361, 620) * SEED_VOTE_COUNT_MULTIPLIER;
  }

  return valueInRange(spreadSeed, 621, 1150) * SEED_VOTE_COUNT_MULTIPLIER;
}

function getDemoChildSeedVoteCount(args: {
  parentPostId: string;
  parentSeedVoteCount: number;
  postId: string;
}): number {
  const bucket = fnv1a32(`${args.postId}:${args.parentPostId}:bucket`) % 100;
  const spreadSeed = fnv1a32(`${args.postId}:${args.parentPostId}:spread`);

  let scaled: number;
  if (bucket < 70) {
    const ratioPermille = valueInRange(spreadSeed, 140, 460);
    scaled = Math.round((args.parentSeedVoteCount * ratioPermille) / 1000);
  } else if (bucket < 96) {
    const ratioPermille = valueInRange(spreadSeed, 470, 760);
    scaled = Math.round((args.parentSeedVoteCount * ratioPermille) / 1000);
  } else {
    const ratioPermille = valueInRange(spreadSeed, 770, 1080);
    scaled = Math.round((args.parentSeedVoteCount * ratioPermille) / 1000);
  }

  const rootDerived = Math.max(1, scaled * SEED_VOTE_COUNT_MULTIPLIER);
  if (rootDerived > 0) return rootDerived;

  const fallbackBucket = fnv1a32(`${args.postId}:${args.parentPostId}:fallback`) % 100;
  const fallbackSpreadSeed = fnv1a32(`${args.postId}:${args.parentPostId}:fallback:spread`);
  if (fallbackBucket < CHILD_LOW_BUCKET_PERCENT) {
    return valueInRange(fallbackSpreadSeed, 80, 150) * SEED_VOTE_COUNT_MULTIPLIER;
  }
  if (fallbackBucket < CHILD_MID_BUCKET_PERCENT) {
    return valueInRange(fallbackSpreadSeed, 151, 240) * SEED_VOTE_COUNT_MULTIPLIER;
  }
  return valueInRange(fallbackSpreadSeed, 241, 360) * SEED_VOTE_COUNT_MULTIPLIER;
}

function loadDotenvFile(envFilePath: string): EnvMap {
  if (!existsSync(envFilePath)) {
    throw new Error(`Missing env file: ${envFilePath}`);
  }

  const env: EnvMap = {};
  for (const line of readFileSync(envFilePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadMergedEnv(envFilePaths: string[]): EnvMap {
  return Object.assign({}, ...envFilePaths.map(loadDotenvFile));
}

function loadRailwayBrainjuiceHonoEnv(
  name: Exclude<PublishTarget["name"], "local">,
): EnvMap {
  const output = execFileSync(
    "railway",
    [
      "variable",
      "--service",
      "brainjuice-hono",
      "--environment",
      RAILWAY_BRAINJUICE_HONO_ENVIRONMENTS[name],
      "--json",
    ],
    {
      cwd: HONO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output) as EnvMap;
}

function resolveEnvPath(envFilePath: string, maybeRelativePath: string): string {
  return isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : resolve(dirname(envFilePath), maybeRelativePath);
}

function buildTarget(name: PublishTarget["name"]): PublishTarget {
  const databaseEnvFilePaths =
    name === "local"
      ? [join(HONO_ROOT, ".env.local"), join(HONO_ROOT, ".env.brainjuice.local")]
      : [join(HONO_ROOT, `.env.${name}`)];
  const firebaseEnvFilePaths =
    name === "local" ? databaseEnvFilePaths : [join(PLAYGROUND_ROOT, `.env.${name}`)];
  const databaseEnv =
    name === "local" ? loadMergedEnv(databaseEnvFilePaths) : loadRailwayBrainjuiceHonoEnv(name);
  const firebaseEnv = loadMergedEnv(firebaseEnvFilePaths);
  const databaseUrl = databaseEnv.DATABASE_URL;
  const firebaseConfig = firebaseEnv.FIREBASE_CONFIG;
  if (!databaseUrl) throw new Error(`${name} is missing DATABASE_URL`);
  if (!firebaseConfig) throw new Error(`${name} is missing FIREBASE_CONFIG`);

  return {
    databaseUrl,
    databaseSsl:
      name !== "local" || databaseEnv.DB_SSL === "true"
        ? { rejectUnauthorized: databaseEnv.DB_SSL_REJECT_UNAUTHORIZED === "true" }
        : false,
    envFilePaths: [...databaseEnvFilePaths, ...firebaseEnvFilePaths],
    firebaseConfigPath: resolveEnvPath(firebaseEnvFilePaths.at(-1)!, firebaseConfig),
    name,
    posthogProjectId: POSTHOG_PROJECTS[name],
  };
}

function initFirebaseForTarget(target: PublishTarget): {
  app: App;
  bucketName: string;
} {
  const serviceAccount = JSON.parse(readFileSync(target.firebaseConfigPath, "utf8")) as ServiceAccount & {
    project_id?: string;
  };
  if (!serviceAccount.project_id) {
    throw new Error(`${target.name} Firebase service account is missing project_id`);
  }
  const bucketName = `${serviceAccount.project_id}.firebasestorage.app`;
  const appName = `final-onboarding-demo-videos-${target.name}`;
  const existing = getApps().find((app) => app.name === appName);
  const app =
    existing ??
    initializeApp(
      {
        credential: cert(serviceAccount),
        storageBucket: bucketName,
      },
      appName,
    );
  return { app, bucketName };
}

function firebaseMediaUrl(bucketName: string, storagePath: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

function renderedVideoPath(post: DemoPost): string {
  if (post.artifact.kind !== "rendered-mp4") {
    throw new Error(`${post.id} is not a rendered MP4 post`);
  }
  return join(FINAL_DEMO_DIR, post.artifact.fileName);
}

function slideshowDir(post: DemoPost): string {
  if (post.artifact.kind !== "html-slideshow") {
    throw new Error(`${post.id} is not an HTML slideshow post`);
  }
  return join(FINAL_DEMO_DIR, post.artifact.directoryName);
}

function slideFilenames(post: DemoPost): string[] {
  if (post.artifact.kind !== "html-slideshow") return [];
  return Array.from({ length: post.artifact.slideCount }, (_, index) =>
    `slide-${String(index + 1).padStart(2, "0")}.webp`,
  );
}

function assertFinalArtifacts() {
  const ids = new Set<string>();
  for (const post of DEMO_POSTS) {
    if (ids.has(post.id)) throw new Error(`Duplicate post ID: ${post.id}`);
    ids.add(post.id);
    if (post.comments.length < 8 || post.comments.length > 12) {
      throw new Error(`${post.id} should have 8-12 comments`);
    }

    if (post.artifact.kind === "rendered-mp4") {
      const path = renderedVideoPath(post);
      if (!existsSync(path) || !statSync(path).isFile()) {
        throw new Error(`Missing final video file: ${path}`);
      }
      continue;
    }

    const dir = slideshowDir(post);
    const requiredFiles = ["index.html", ...slideFilenames(post)];
    for (const filename of requiredFiles) {
      const path = join(dir, filename);
      if (!existsSync(path) || !statSync(path).isFile()) {
        throw new Error(`Missing final slideshow file: ${path}`);
      }
    }
  }
}

function normalizeComment(comment: DemoComment | string): DemoComment {
  return typeof comment === "string" ? { text: comment } : comment;
}

function commenterFor(postIndex: number, commentIndex: number, comment: DemoComment) {
  if (comment.profileId) {
    const explicit = DEMO_SYNTH_USERS.find((user) => user.profileId === comment.profileId);
    if (explicit) return explicit;
  }
  const commenters = DEMO_SYNTH_USERS.slice(1);
  const threadShapes = [
    [3, 1, 4, 1, 6, 2, 1, 5, 4, 7, 2, 6],
    [6, 1, 6, 2, 5, 3, 7, 4, 1, 5, 2, 6],
    [1, 4, 2, 4, 5, 7, 3, 1, 6, 2, 5, 4],
    [2, 1, 2, 3, 6, 5, 7, 4, 1, 3, 5, 2],
  ];
  const shape = threadShapes[postIndex % threadShapes.length]!;
  const commenterNumber = shape[commentIndex % shape.length]!;
  return commenters[(commenterNumber - 1) % commenters.length]!;
}

async function uploadBuffer(args: {
  app: App;
  contentType: string;
  data: Buffer | string;
  storagePath: string;
}) {
  const bucket = getStorage(args.app).bucket();
  const buffer = Buffer.isBuffer(args.data) ? args.data : Buffer.from(args.data);
  const isText = args.contentType.startsWith("text/") || args.contentType === "application/javascript";
  await bucket.file(args.storagePath).save(isText ? gzipSync(buffer) : buffer, {
    metadata: {
      cacheControl: "public, max-age=31536000, immutable",
      contentEncoding: isText ? "gzip" : undefined,
      contentType: args.contentType,
    },
  });
}

function rewriteDevBucketStaticUrls(html: string, bucketName: string): string {
  return html.replace(
    /https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/brainjuice-dev\.firebasestorage\.app\/o\/([^"'()\s<>&]+)\?alt=media/g,
    (_match, encodedPath: string) => firebaseMediaUrl(bucketName, decodeURIComponent(encodedPath)),
  );
}

function ensureNoTextSelectionCss(html: string): string {
  if (
    html.includes('id="brainjuice-no-text-selection-style"') ||
    html.includes("id='brainjuice-no-text-selection-style'")
  ) {
    return html;
  }
  const style = `<style id="brainjuice-no-text-selection-style">
html,body,body *{-webkit-touch-callout:none!important;-webkit-user-select:none!important;user-select:none!important}
::selection{background:transparent!important}
</style>`;
  return html.includes("</head>") ? html.replace("</head>", `${style}</head>`) : `${style}${html}`;
}

async function uploadArtifact(target: PublishTarget, post: DemoPost) {
  const { app, bucketName } = initFirebaseForTarget(target);
  const storagePrefix = `brainjuice/generated/${post.id}`;

  if (post.artifact.kind === "rendered-mp4") {
    const storagePath = `${storagePrefix}/rendered.mp4`;
    await uploadBuffer({
      app,
      contentType: "video/mp4",
      data: readFileSync(renderedVideoPath(post)),
      storagePath,
    });
    return {
      artifactUrl: firebaseMediaUrl(bucketName, storagePath),
      bucketName,
      storagePath,
      uploadedFileCount: 1,
    };
  }

  const dir = slideshowDir(post);
  for (const filename of slideFilenames(post)) {
    await uploadBuffer({
      app,
      contentType: "image/webp",
      data: readFileSync(join(dir, filename)),
      storagePath: `${storagePrefix}/${filename}`,
    });
  }

  let html = readFileSync(join(dir, "index.html"), "utf8");
  html = rewriteDevBucketStaticUrls(html, bucketName);
  for (const filename of slideFilenames(post)) {
    html = html.replaceAll(filename, firebaseMediaUrl(bucketName, `${storagePrefix}/${filename}`));
  }
  html = ensureNoTextSelectionCss(html);

  const storagePath = `${storagePrefix}/artifact/index.html`;
  await uploadBuffer({
    app,
    contentType: "text/html; charset=utf-8",
    data: html,
    storagePath,
  });

  return {
    artifactUrl: firebaseMediaUrl(bucketName, storagePath),
    bucketName,
    storagePath,
    uploadedFileCount: post.artifact.slideCount + 1,
  };
}

function postContents(post: DemoPost) {
  return {
    description: post.description,
    shortTitle: post.title,
    videoData:
      post.artifact.kind === "rendered-mp4"
        ? {
            durationSeconds: post.durationSeconds,
            props: {},
            recompiledAt: new Date().toISOString(),
            renderedOnly: true,
            renderer: "hyperframes",
            templateId: post.artifact.templateId,
          }
        : {
            durationSeconds: post.durationSeconds,
            props: {},
            recompiledAt: new Date().toISOString(),
            renderer: "html-slideshow",
            templateId: post.artifact.templateId,
          },
    videoDescription: post.description,
  };
}

function originInfo(post: DemoPost, artifactUrl: string) {
  const firebaseStoragePath =
    post.artifact.kind === "rendered-mp4"
      ? `brainjuice/generated/${post.id}/rendered.mp4`
      : `brainjuice/generated/${post.id}/artifact/index.html`;
  return {
    firebaseStoragePath,
    source: post.sourceLabel,
    viewerUrl: artifactUrl,
  };
}

async function upsertBaseRows(client: pg.PoolClient) {
  await client.query(
    `insert into "user" (id, email, name, language)
     values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [DEMO_USER_ID, "demo@brainjuice.dev", "Brainjuice Demo", "en"],
  );
  await client.query(
    `insert into feed (
      id, name, origin_type, origin_info, gen_state, gen_info, gen_history,
      user_id, picture_path, short_desc, contents, language, first_post_id,
      gen_duration_ms, observation_id, picture, source_podcast_episode_id, userfile_id
    ) values (
      $1, $2, 'USER', $3::jsonb, 'COMPLETE', '{}'::jsonb, '[]'::jsonb,
      $4, null, $5, $6::jsonb, 'en', $7,
      null, null, null, null, null
    )
    on conflict (id) do update set
      name = excluded.name,
      origin_type = excluded.origin_type,
      origin_info = excluded.origin_info,
      gen_state = excluded.gen_state,
      gen_info = excluded.gen_info,
      gen_history = excluded.gen_history,
      user_id = excluded.user_id,
      short_desc = excluded.short_desc,
      contents = excluded.contents,
      language = excluded.language,
      first_post_id = excluded.first_post_id`,
    [
      DEMO_FEED_ID,
      "Brainjuice Rendered Demo Feed",
      JSON.stringify({ source: BATCH_SOURCE_LABEL }),
      DEMO_USER_ID,
      "Onboarding demo feed for Brainjuice sample videos.",
      JSON.stringify({ demo: true, onboarding: true }),
      DEMO_POSTS[0]!.id,
    ],
  );
  await client.query(
    `insert into synthuser (
      id, name, username, picture, gender, tagline, profession, visual_description
    ) values
      ${DEMO_SYNTH_USERS.map(
        (_, index) =>
          `($${index * 8 + 1}, $${index * 8 + 2}, $${index * 8 + 3}, $${index * 8 + 4}, $${index * 8 + 5}, $${index * 8 + 6}, $${index * 8 + 7}, $${index * 8 + 8})`,
      ).join(", ")}
    on conflict (id) do update set
      name = excluded.name,
      username = excluded.username,
      picture = excluded.picture,
      gender = excluded.gender,
      tagline = excluded.tagline,
      profession = excluded.profession,
      visual_description = excluded.visual_description`,
    DEMO_SYNTH_USERS.flatMap((user) => [
      user.id,
      user.name,
      user.username,
      user.picture,
      "unknown",
      "Brainjuice onboarding demo persona",
      "Demo learner",
      "Friendly illustrated avatar for onboarding demo testing.",
    ]),
  );
  for (const profile of DEMO_SYNTH_USERS) {
    await client.query(
      `insert into profile (
        id, name, type, feed_id, chapter_id, owner_user_id, synthuser_id, user_id
      ) values ($1, $2, 'SYNTHETIC', $3, null, null, $4, null)
      on conflict (id) do update set
        name = excluded.name,
        type = excluded.type,
        feed_id = excluded.feed_id,
        synthuser_id = excluded.synthuser_id`,
      [profile.profileId, profile.name, DEMO_FEED_ID, profile.id],
    );
  }
  await client.query(
    `insert into chapter (
      id, feed_id, name, "desc", sort_order, gen_state, gen_info, gen_history,
      origin_info, origin_type, contents, gen_duration_ms, learning_topic_id,
      observation_id, suggested_by
    ) values (
      $1, $2, $3, $4, 0, 'COMPLETE', '{}'::jsonb, '[]'::jsonb,
      $5::jsonb, 'USER', $6::jsonb, null, null, null, null
    )
    on conflict (id) do update set
      feed_id = excluded.feed_id,
      name = excluded.name,
      "desc" = excluded."desc",
      sort_order = excluded.sort_order,
      gen_state = excluded.gen_state,
      gen_info = excluded.gen_info,
      gen_history = excluded.gen_history,
      origin_info = excluded.origin_info,
      origin_type = excluded.origin_type,
      contents = excluded.contents`,
    [
      DEMO_CHAPTER_ID,
      DEMO_FEED_ID,
      "Brainjuice onboarding demos",
      "Demo videos for Brainjuice onboarding.",
      JSON.stringify({ source: BATCH_SOURCE_LABEL }),
      JSON.stringify({ demo: true, onboarding: true }),
    ],
  );
}

async function upsertPostRows(
  client: pg.PoolClient,
  post: DemoPost,
  sortOrder: number,
  artifactUrl: string,
) {
  const rootSeedVoteCount = getDemoRootSeedVoteCount(post.id);
  await client.query(
    `insert into post (
      id, chapter_id, contents, display_style, gen_state, gen_info, gen_history,
      origin_info, origin_type, parent_post_id, poster_profile_id, sort_order,
      seed_vote_count, text, attachment, gen_duration_ms, observation_id, quiz_data, user_interactions
    ) values (
      $1, $2, $3::jsonb, 'BASIC', 'COMPLETE', '{}'::jsonb, '[]'::jsonb,
      $4::jsonb, 'USER', null, $5, $6, $7, $8, null, null, null, null, null
    )
    on conflict (id) do update set
      chapter_id = excluded.chapter_id,
      contents = excluded.contents,
      display_style = excluded.display_style,
      gen_state = excluded.gen_state,
      gen_info = excluded.gen_info,
      gen_history = excluded.gen_history,
      origin_info = excluded.origin_info,
      origin_type = excluded.origin_type,
      parent_post_id = excluded.parent_post_id,
      poster_profile_id = excluded.poster_profile_id,
      sort_order = excluded.sort_order,
      seed_vote_count = excluded.seed_vote_count,
      text = excluded.text`,
    [
      post.id,
      DEMO_CHAPTER_ID,
      JSON.stringify(postContents(post)),
      JSON.stringify(originInfo(post, artifactUrl)),
      DEMO_PROFILE_ID,
      sortOrder,
      rootSeedVoteCount,
      post.title,
    ],
  );

  await client.query(`delete from post where parent_post_id = $1`, [post.id]);

  for (const [index, rawComment] of post.comments.entries()) {
    const comment = normalizeComment(rawComment);
    const commenter = commenterFor(sortOrder, index, comment);
    const commentId = `${post.id}_c${String(index + 1).padStart(2, "0")}`;
    const commentSeedVoteCount = getDemoChildSeedVoteCount({
      parentPostId: post.id,
      parentSeedVoteCount: rootSeedVoteCount,
      postId: commentId,
    });
    await client.query(
      `insert into post (
        id, chapter_id, contents, display_style, gen_state, gen_info, gen_history,
        origin_info, origin_type, parent_post_id, poster_profile_id, sort_order,
        seed_vote_count, text, attachment, gen_duration_ms, observation_id, quiz_data, user_interactions
      ) values (
        $1, $2, null, 'BASIC', 'COMPLETE', '{}'::jsonb, '[]'::jsonb,
        $3::jsonb, 'LLM', $4, $5, $6, $7, $8, null, null, null, null, null
      )
      on conflict (id) do update set
        chapter_id = excluded.chapter_id,
        contents = excluded.contents,
        display_style = excluded.display_style,
        gen_state = excluded.gen_state,
        gen_info = excluded.gen_info,
        gen_history = excluded.gen_history,
        origin_info = excluded.origin_info,
        origin_type = excluded.origin_type,
        parent_post_id = excluded.parent_post_id,
        poster_profile_id = excluded.poster_profile_id,
        sort_order = excluded.sort_order,
        seed_vote_count = excluded.seed_vote_count,
        text = excluded.text`,
      [
        commentId,
        DEMO_CHAPTER_ID,
        JSON.stringify({
          parentPostId: post.id,
          source: post.sourceLabel,
        }),
        post.id,
        commenter.profileId,
        index,
        commentSeedVoteCount,
        comment.text,
      ],
    );
  }
}

async function upsertDatabaseRows(
  target: PublishTarget,
  artifactUrls: Map<string, string>,
) {
  const pool = new pg.Pool({
    connectionString: target.databaseUrl,
    max: 2,
    ssl: target.databaseSsl,
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await upsertBaseRows(client);
    for (const [index, post] of DEMO_POSTS.entries()) {
      const artifactUrl = artifactUrls.get(post.id);
      if (!artifactUrl) throw new Error(`Missing artifact URL for ${post.id}`);
      await upsertPostRows(client, post, index, artifactUrl);
    }
    await client.query(`update feed set first_post_id = $1 where id = $2`, [
      DEMO_POSTS[0]!.id,
      DEMO_FEED_ID,
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function loadPosthogEnv(): EnvMap {
  return loadDotenvFile(join(HONO_ROOT, ".env.local"));
}

function buildPosthogPayload() {
  const postIds = [...DEMO_POSTS.map((post) => post.id), ONBOARDING_END_QUIZ_POST_ID];
  return {
    postIds,
    postTagMap: Object.fromEntries(DEMO_POSTS.map((post) => [post.id, post.tagIds])),
  };
}

async function updatePosthogFlag(target: PublishTarget, dryRun: boolean) {
  const posthogEnv = loadPosthogEnv();
  const host = posthogEnv.POSTHOG_HOST;
  const apiKey = posthogEnv.POSTHOG_PERSONAL_API_KEY;
  if (!host || !apiKey) {
    throw new Error("Missing POSTHOG_HOST or POSTHOG_PERSONAL_API_KEY in hivemind-hono/.env.local");
  }
  const baseUrl = `${host}/api/projects/${target.posthogProjectId}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const listResponse = await fetch(
    `${baseUrl}/feature_flags/?search=${encodeURIComponent(POSTHOG_FLAG_KEY)}`,
    { headers },
  );
  if (!listResponse.ok) {
    throw new Error(
      `${target.name} PostHog feature flag lookup failed ${listResponse.status}: ${await listResponse.text()}`,
    );
  }
  const listData = (await listResponse.json()) as {
    results?: Array<{ filters?: { payloads?: { true?: unknown } }; id: number; key: string; name?: string }>;
  };
  const existing = listData.results?.find((flag) => flag.key === POSTHOG_FLAG_KEY);
  const nextPayload = buildPosthogPayload();
  const filters = {
    aggregation_group_type_index: null,
    groups: [
      {
        aggregation_group_type_index: null,
        properties: [],
        rollout_percentage: 100,
        variant: null,
      },
    ],
    multivariate: null,
    payloads: {
      true: nextPayload,
    },
  };

  if (dryRun) {
    console.log(`[dry-run] ${target.name} PostHog exact payload`, nextPayload);
    return nextPayload;
  }

  const body = JSON.stringify({
    active: true,
    filters,
    key: POSTHOG_FLAG_KEY,
    name: existing?.name ?? "Brainjuice onboarding demo post IDs",
  });
  const response = existing
    ? await fetch(`${baseUrl}/feature_flags/${existing.id}/`, {
        body,
        headers,
        method: "PATCH",
      })
    : await fetch(`${baseUrl}/feature_flags/`, {
        body,
        headers,
        method: "POST",
      });
  if (!response.ok) {
    throw new Error(
      `${target.name} PostHog feature flag update failed ${response.status}: ${await response.text()}`,
    );
  }
  return nextPayload;
}

async function verifyDatabase(target: PublishTarget) {
  const pool = new pg.Pool({
    connectionString: target.databaseUrl,
    max: 1,
    ssl: target.databaseSsl,
  });
  try {
    const result = await pool.query(
      `select
        p.id,
        p.text,
        p.sort_order,
        p.seed_vote_count,
        p.contents -> 'videoData' ->> 'renderer' as renderer,
        (
          select count(*)
          from post c
          where c.parent_post_id = p.id
        )::int as comments
      from post p
      where p.id = any($1::text[])
      order by p.sort_order asc`,
      [DEMO_POSTS.map((post) => post.id)],
    );
    return result.rows as Array<{
      comments: number;
      id: string;
      renderer: string;
      seed_vote_count: number;
      sort_order: number;
      text: string;
    }>;
  } finally {
    await pool.end();
  }
}

async function verifyStorage(target: PublishTarget, post: DemoPost) {
  const { app } = initFirebaseForTarget(target);
  const storagePath =
    post.artifact.kind === "rendered-mp4"
      ? `brainjuice/generated/${post.id}/rendered.mp4`
      : `brainjuice/generated/${post.id}/artifact/index.html`;
  const [metadata] = await getStorage(app).bucket().file(storagePath).getMetadata();
  return {
    contentEncoding: metadata.contentEncoding ?? null,
    contentType: metadata.contentType ?? null,
    size: Number(metadata.size ?? 0),
    storagePath,
  };
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  assertFinalArtifacts();
  const targets = options.targetNames.map(buildTarget);
  console.log("[final-onboarding-demo-videos] publishing", {
    dryRun: options.dryRun,
    postIds: DEMO_POSTS.map((post) => post.id),
    targets: targets.map((target) => target.name),
  });

  const summaries = [];
  for (const target of targets) {
    console.log(`[final-onboarding-demo-videos] target ${target.name}: upload artifacts`);
    const artifactUrls = new Map<string, string>();
    const uploads = [];
    for (const post of DEMO_POSTS) {
      const upload = options.dryRun
        ? {
            artifactUrl: "(dry-run)",
            bucketName:
              JSON.parse(readFileSync(target.firebaseConfigPath, "utf8")).project_id +
              ".firebasestorage.app",
            storagePath:
              post.artifact.kind === "rendered-mp4"
                ? `brainjuice/generated/${post.id}/rendered.mp4`
                : `brainjuice/generated/${post.id}/artifact/index.html`,
            uploadedFileCount: 0,
          }
        : await uploadArtifact(target, post);
      artifactUrls.set(post.id, upload.artifactUrl);
      uploads.push({
        postId: post.id,
        storagePath: upload.storagePath,
        uploadedFileCount: upload.uploadedFileCount,
      });
    }

    console.log(`[final-onboarding-demo-videos] target ${target.name}: upsert DB rows`);
    if (!options.dryRun) await upsertDatabaseRows(target, artifactUrls);
    console.log(`[final-onboarding-demo-videos] target ${target.name}: set PostHog payload`);
    const posthogPayload = await updatePosthogFlag(target, options.dryRun);
    const dbRows = options.dryRun ? [] : await verifyDatabase(target);
    const storage = options.dryRun
      ? []
      : await Promise.all(DEMO_POSTS.map((post) => verifyStorage(target, post)));
    summaries.push({
      dbRows,
      posthogPostCount: posthogPayload.postIds.length,
      posthogPostIds: posthogPayload.postIds,
      storage,
      target: target.name,
      uploads,
    });
  }
  console.log(JSON.stringify({ summaries }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

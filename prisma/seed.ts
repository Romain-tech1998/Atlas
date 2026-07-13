import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEMO_EMAIL = "demo@atlas.local";
const DEMO_PASSWORD = "atlas-demo-1234";

// Sprint-012: enough sample data to actually demonstrate "Load more" and
// search (the default page size is 20 — fewer rows than this would never
// show a second page). Deliberately plain, varied factual sentences, not
// generated filler text, so search results still read like real Memories.
// One entry ("My rent is 1400 CAD") exists specifically so a "rent" search
// has something real to find.
const SAMPLE_MEMORY_CONTENTS = [
  "My rent is 1400 CAD",
  "I like oat milk",
  "My salary is 3500 CAD",
  "I prefer window seats on flights",
  "My passport expires in March 2027",
  "I'm allergic to peanuts",
  "My gym membership renews every January",
  "I usually work from home on Fridays",
  "My car insurance is due in June",
  "I don't eat red meat",
  "My favorite coffee order is a flat white",
  "I have a dentist appointment every six months",
  "My phone plan costs 45 CAD a month",
  "I prefer trains over buses for short trips",
  "My internet provider is Bell",
  "I water the plants every Sunday",
  "My favourite season is autumn",
  "I keep a spare key with my neighbour",
  "My laptop is a 2023 model",
  "I usually go grocery shopping on Saturdays",
  "My budget for a new laptop is 1500 CAD",
  "I take the bus to work most days",
  "My electricity bill averages 80 CAD a month",
  "I prefer tea over coffee in the evening",
  "My bike needs a new tire",
  "I volunteer at the food bank once a month",
] as const;

// Sprint-012: same reasoning as SAMPLE_MEMORY_CONTENTS — enough rows to
// demonstrate paginated browsing and search across both `title` and
// `content`. `axisRequestId` is left null; these are seed data, not real
// pipeline output, and the column is nullable for exactly this reason.
const SAMPLE_DOCUMENTS: ReadonlyArray<{ title: string; content: string }> = [
  {
    title: "Apartment lease",
    content: "The monthly rent is 1400 CAD. The lease begins on September 1, 2026. Pets are not permitted.",
  },
  {
    title: "Moving checklist",
    content: "Book movers, forward mail, update address with the bank, cancel old internet plan.",
  },
  { title: "Recipe: banana bread", content: "3 ripe bananas, 2 eggs, 1 cup sugar, 1.5 cups flour, 1 tsp baking soda." },
  { title: "Trip notes: Tokyo", content: "Flight lands at Narita. Hotel is booked near Shinjuku for 5 nights." },
  { title: "Car maintenance log", content: "Oil changed at 45,000 km. Brake pads replaced. Next service due in 6 months." },
  { title: "Book club notes", content: "Next meeting is the second Tuesday of the month. Currently reading a mystery novel." },
  { title: "Garden planting plan", content: "Tomatoes and basil go in the south bed. Peppers need more shade." },
  { title: "Job offer summary", content: "Base salary 78000 CAD, three weeks vacation, hybrid work schedule." },
  { title: "Wedding guest list draft", content: "Roughly 80 guests expected. Venue holds up to 120." },
  { title: "Home insurance policy notes", content: "Annual premium is 900 CAD. Deductible is 500 CAD." },
  { title: "Meal plan: week 1", content: "Monday: pasta. Tuesday: stir fry. Wednesday: leftovers. Thursday: tacos." },
  { title: "Workout routine", content: "Monday: legs. Wednesday: upper body. Friday: cardio and core." },
  { title: "Budget planning notes", content: "Rent, groceries, and transit make up most of the monthly budget." },
  { title: "Warranty info: washing machine", content: "Purchased in May 2025. Warranty covers parts for 2 years." },
  { title: "Passport renewal steps", content: "Fill out the form, get a new photo, book an appointment, pay the fee." },
  { title: "Conference notes", content: "Keynote covered deterministic systems. Second talk was about testing." },
  { title: "Rental car agreement", content: "Full insurance included. Return with a full tank. Drop-off by noon." },
  { title: "Freelance contract draft", content: "Payment terms are net 30. Scope covers three deliverables." },
  { title: "House hunting notes", content: "Prefer a two-bedroom under 2200 CAD near transit." },
  { title: "Pet vet visit summary", content: "Annual checkup done. Vaccinations up to date. Next visit in a year." },
  { title: "Course syllabus notes", content: "Midterm in week 7. Final project due the last week of term." },
  { title: "Team offsite agenda", content: "Morning is planning, afternoon is a retrospective." },
  { title: "Furniture assembly notes", content: "Bookshelf took about 40 minutes. Missing one bracket, requested a replacement." },
  { title: "Utility switch checklist", content: "Compare providers, confirm move-in date, schedule the switch." },
  { title: "Language learning log", content: "Practicing 15 minutes a day. Focused on past tense verbs this week." },
] as const;

async function seedMemories(userId: string) {
  const existingCount = await prisma.memory.count({ where: { userId } });
  if (existingCount >= SAMPLE_MEMORY_CONTENTS.length) {
    console.log(`Demo user already has ${existingCount} memories, skipping memory seed.`);
    return;
  }

  await prisma.memory.createMany({
    data: SAMPLE_MEMORY_CONTENTS.map((content) => ({ userId, type: "FACT" as const, content, source: "seed" })),
  });
  console.log(`Seeded ${SAMPLE_MEMORY_CONTENTS.length} sample memories.`);
}

async function seedDocuments(userId: string) {
  const existingCount = await prisma.document.count({ where: { userId } });
  if (existingCount >= SAMPLE_DOCUMENTS.length) {
    console.log(`Demo user already has ${existingCount} documents, skipping document seed.`);
    return;
  }

  await prisma.document.createMany({
    data: SAMPLE_DOCUMENTS.map(({ title, content }) => ({ userId, title, content })),
  });
  console.log(`Seeded ${SAMPLE_DOCUMENTS.length} sample documents.`);
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      name: "Demo User",
    },
  });

  console.log(`Seeded demo user: ${user.email} / ${DEMO_PASSWORD}`);

  await seedMemories(user.id);
  await seedDocuments(user.id);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

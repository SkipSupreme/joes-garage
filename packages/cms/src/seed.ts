/**
 * Seed script for Joe's Garage CMS.
 *
 * Uploads photos from the old website, seeds collections
 * (Services, Bikes, Testimonials), populates SiteSettings,
 * and creates all CMS pages with their block layouts.
 *
 * Usage:
 *   1. Start the CMS: pnpm --filter cms dev
 *   2. Run: npx tsx packages/cms/src/seed.ts
 *
 * The script is idempotent — it checks for existing content
 * before creating duplicates.
 */

import fs from 'node:fs';
import path from 'node:path';

const PAYLOAD_URL = process.env.PAYLOAD_URL || 'http://localhost:3003';
const ADMIN_EMAIL = 'joshhunterduvar@gmail.com';
const ADMIN_PASSWORD = '"unknown"';

// Resolve old website path relative to monorepo root
const OLD_SITE = path.resolve(import.meta.dirname, '../../../Joes Garage Old Website');

let token = '';

// ─── API Helpers ─────────────────────────────────

async function login(): Promise<string> {
  const res = await fetch(`${PAYLOAD_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.token;
}

async function apiGet(endpoint: string) {
  const res = await fetch(`${PAYLOAD_URL}/api${endpoint}`, {
    headers: { Authorization: `JWT ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${endpoint} failed: ${res.status}`);
  return res.json();
}

async function apiPost(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(`${PAYLOAD_URL}/api${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `JWT ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${endpoint} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function apiPatchGlobal(slug: string, body: Record<string, unknown>) {
  const res = await fetch(`${PAYLOAD_URL}/api/globals/${slug}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `JWT ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST globals/${slug} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function uploadMedia(filePath: string, alt: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ File not found: ${filePath}`);
    return 0;
  }

  const formData = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const mimeType = mimeTypes[ext] || 'image/jpeg';

  formData.append('file', new Blob([fileBuffer], { type: mimeType }), path.basename(filePath));
  formData.append('_payload', JSON.stringify({ alt }));

  const res = await fetch(`${PAYLOAD_URL}/api/media`, {
    method: 'POST',
    headers: { Authorization: `JWT ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`  ✗ Upload failed for ${path.basename(filePath)}: ${res.status} ${text}`);
    return 0;
  }

  const data = await res.json();
  console.log(`  ✓ Uploaded: ${alt} (ID: ${data.doc.id})`);
  return data.doc.id;
}

// ─── Check if collection has data ────────────────

async function collectionCount(slug: string): Promise<number> {
  const data = await apiGet(`/${slug}?limit=1`);
  return data.totalDocs || 0;
}

// ─── Phase 1: Upload Photos ─────────────────────

interface MediaIds {
  containerExterior: number;
  joePortrait: number;
  joeWorking: number;
  joeCloseup: number;
  kidsBikes: number;
  rentalsHeader: number;
  toolsCloseup: number;
  toolsWide: number;
  groupPhoto: number;
  setup32: number;
  setup59: number;
  setup72: number;
  detoursFeature: number;
  // Gallery extras
  gallery2011a: number;
  gallery2011b: number;
  gallery2011c: number;
  gallery2012a: number;
}

async function uploadPhotos(): Promise<MediaIds> {
  console.log('\n📸 Uploading photos...');

  const existing = await collectionCount('media');
  if (existing > 5) {
    console.log(`  Media already has ${existing} items, skipping uploads.`);
    // Return first N media IDs for page creation
    const media = await apiGet('/media?limit=20');
    const docs = media.docs;
    return {
      containerExterior: docs[0]?.id || 0,
      joePortrait: docs[1]?.id || 0,
      joeWorking: docs[2]?.id || 0,
      joeCloseup: docs[3]?.id || 0,
      kidsBikes: docs[4]?.id || 0,
      rentalsHeader: docs[5]?.id || 0,
      toolsCloseup: docs[6]?.id || 0,
      toolsWide: docs[7]?.id || 0,
      groupPhoto: docs[8]?.id || 0,
      setup32: docs[9]?.id || 0,
      setup59: docs[10]?.id || 0,
      setup72: docs[11]?.id || 0,
      detoursFeature: docs[12]?.id || 0,
      gallery2011a: docs[13]?.id || 0,
      gallery2011b: docs[14]?.id || 0,
      gallery2011c: docs[15]?.id || 0,
      gallery2012a: docs[16]?.id || 0,
    };
  }

  const imgs = path.join(OLD_SITE, 'images');
  const joe = path.join(OLD_SITE, 'Joe');

  const ids: MediaIds = {
    containerExterior: await uploadMedia(path.join(imgs, 'joesgarage2022_b.jpg'), "Joe's Garage shipping container on the Bow River pathway"),
    joePortrait: await uploadMedia(path.join(imgs, 'Joes_Jared_Sych.jpg'), 'Joe Nunn — professional portrait by Jared Sych'),
    joeWorking: await uploadMedia(path.join(imgs, 'joeWorking.jpg'), 'Joe working on a bike repair'),
    joeCloseup: await uploadMedia(path.join(imgs, 'Joes_closeup_JS.jpg'), 'Joe Nunn closeup portrait'),
    kidsBikes: await uploadMedia(path.join(imgs, 'kidsBikes.jpg'), "Kids' bikes available for rent"),
    rentalsHeader: await uploadMedia(path.join(imgs, 'rentals_header.jpg'), 'Rental bikes lined up and ready to ride'),
    toolsCloseup: await uploadMedia(path.join(imgs, 'tools96-b.jpg'), 'Professional bike repair tools close-up'),
    toolsWide: await uploadMedia(path.join(imgs, 'tools.jpg'), 'Bike tools and workshop'),
    groupPhoto: await uploadMedia(path.join(imgs, 'group_photo.jpg'), "Joe's Garage community group photo"),
    setup32: await uploadMedia(path.join(imgs, 'setup32.jpg'), 'Shop setup — workbench and tools'),
    setup59: await uploadMedia(path.join(imgs, 'setup59.jpg'), 'Shop setup — container interior'),
    setup72: await uploadMedia(path.join(imgs, 'setup72.jpg'), 'Shop setup — bikes on display'),
    detoursFeature: await uploadMedia(path.join(joe, 'Detours-JoesGarage1.jpg'), "Joe's Garage featured in Detours magazine"),
    gallery2011a: await uploadMedia(path.join(imgs, '2011_069_b.jpg'), 'Joe repairing bikes on the pathway — 2011'),
    gallery2011b: await uploadMedia(path.join(imgs, '2011_153_b.jpg'), 'Early days on the Bow River pathway — 2011'),
    gallery2011c: await uploadMedia(path.join(imgs, '2011_215_b.jpg'), 'Serving cyclists on the pathway — 2011'),
    gallery2012a: await uploadMedia(path.join(imgs, '2012_1721_b.jpg'), 'Growing the business — 2012'),
  };

  return ids;
}

// ─── Phase 2: Seed Services ─────────────────────

async function seedServices() {
  console.log('\n🔧 Seeding services...');

  const existing = await collectionCount('services');
  if (existing > 0) {
    console.log(`  Services already has ${existing} items, skipping.`);
    return;
  }

  const services = [
    { name: 'Basic Tune-Up', description: 'Brake and derailleur adjustment, tire inflation, chain lube, safety check. Perfect for regular maintenance.', price: 60, estimatedTime: '1-2 hours' },
    { name: 'Standard Tune-Up', description: 'Everything in Basic, plus wheel truing, hub adjustment, cable tension check, and a thorough drivetrain clean.', price: 120, estimatedTime: '2-4 hours' },
    { name: 'Full Overhaul', description: 'Complete teardown and rebuild. Every component inspected, cleaned, greased, and adjusted. Your bike will ride like new.', price: 250, estimatedTime: '1-2 days' },
    { name: 'Flat Repair', description: 'Tube patch or replacement, tire inspection for debris, proper inflation.', price: 20, estimatedTime: '15-30 min' },
    { name: 'Brake Service', description: 'Brake pad replacement, cable adjustment, lever alignment. Rim or disc brakes.', price: 40, estimatedTime: '30-60 min' },
    { name: 'Wheel Truing', description: 'Spoke tension correction and lateral/radial trueing to get your wheel spinning straight.', price: 30, estimatedTime: '30-45 min' },
    { name: 'Drivetrain Clean & Lube', description: 'Full chain, cassette, and chainring clean. Fresh lubricant applied and shifting dialed in.', price: 45, estimatedTime: '45-60 min' },
    { name: 'Bike Fit Consultation', description: 'Saddle height, handlebar position, and cleat alignment. Ride more comfortably and efficiently.', price: 50, estimatedTime: '30-45 min' },
  ];

  for (const svc of services) {
    const doc = await apiPost('/services', svc);
    console.log(`  ✓ ${svc.name} ($${svc.price})`);
  }
}

// ─── Phase 3: Seed Bikes ─────────────────────────

async function seedBikes(mediaIds: MediaIds) {
  console.log('\n🚲 Seeding bikes...');

  const existing = await collectionCount('bikes');
  if (existing > 0) {
    console.log(`  Bikes already has ${existing} items, skipping.`);
    return;
  }

  const bikes = [
    {
      name: 'Adult Cruiser — Reid Pathway',
      type: 'cruiser',
      size: 'large',
      pricePerDay: 40,
      depositAmount: 200,
      photo: mediaIds.rentalsHeader || mediaIds.containerExterior,
      status: 'available',
      features: [
        { feature: '7-speed Shimano gears' },
        { feature: 'Step-through frame' },
        { feature: 'Comfortable saddle' },
        { feature: 'Front basket included' },
      ],
    },
    {
      name: 'Youth 24" — Trail Ready',
      type: 'kids',
      size: 'kids',
      pricePerDay: 30,
      depositAmount: 150,
      photo: mediaIds.kidsBikes || mediaIds.containerExterior,
      status: 'available',
      features: [
        { feature: '24-inch wheels' },
        { feature: '7-speed gears' },
        { feature: 'Front suspension' },
        { feature: 'Ages 8-12' },
      ],
    },
    {
      name: 'Child 20" — First Bike',
      type: 'kids',
      size: 'kids',
      pricePerDay: 25,
      depositAmount: 100,
      photo: mediaIds.kidsBikes || mediaIds.containerExterior,
      status: 'available',
      features: [
        { feature: '20-inch wheels' },
        { feature: 'Single speed' },
        { feature: 'Coaster brake' },
        { feature: 'Ages 5-8' },
      ],
    },
    {
      name: 'Trail-a-Bike Attachment',
      type: 'kids',
      size: 'kids',
      pricePerDay: 20,
      depositAmount: 100,
      photo: mediaIds.kidsBikes || mediaIds.containerExterior,
      status: 'available',
      features: [
        { feature: 'Attaches to adult bike seatpost' },
        { feature: 'Single wheel, child pedals' },
        { feature: 'Ages 4-9' },
      ],
    },
    {
      name: 'Hybrid Commuter',
      type: 'hybrid',
      size: 'medium',
      pricePerDay: 45,
      depositAmount: 250,
      photo: mediaIds.rentalsHeader || mediaIds.containerExterior,
      status: 'available',
      features: [
        { feature: '21-speed Shimano' },
        { feature: 'Disc brakes' },
        { feature: 'Rear rack' },
        { feature: 'Lights included' },
      ],
    },
    {
      name: 'Thule Baby Trailer',
      type: 'kids',
      size: 'kids',
      pricePerDay: 25,
      depositAmount: 150,
      photo: mediaIds.kidsBikes || mediaIds.containerExterior,
      status: 'available',
      features: [
        { feature: 'Seats 1-2 children' },
        { feature: '5-point harness' },
        { feature: 'Weather cover included' },
        { feature: 'Ages 1-5' },
      ],
    },
  ];

  for (const bike of bikes) {
    await apiPost('/bikes', bike);
    console.log(`  ✓ ${bike.name} ($${bike.pricePerDay}/day)`);
  }
}

// ─── Phase 4: Seed Testimonials ──────────────────

async function seedTestimonials() {
  console.log('\n⭐ Seeding testimonials...');

  const existing = await collectionCount('testimonials');
  if (existing > 0) {
    console.log(`  Testimonials already has ${existing} items, skipping.`);
    return;
  }

  const testimonials = [
    {
      quote: "Joe tuned up my commuter bike and it rides like new. Fair prices, honest work, and done the same day. Can't ask for more.",
      name: 'Sarah M., Kensington',
      rating: 5,
    },
    {
      quote: 'Rented a bike right from the container on the pathway. The online booking was seamless, and the bike was in perfect shape. Love this place.',
      name: 'Mike T., Beltline',
      rating: 5,
    },
    {
      quote: "Joe's the kind of guy who'll explain what's wrong with your bike in plain English. No upselling, just straight talk. Legend.",
      name: 'Priya K., Mission',
      rating: 5,
    },
  ];

  for (const t of testimonials) {
    await apiPost('/testimonials', t);
    console.log(`  ✓ ${t.name}`);
  }
}

// ─── Phase 5: Seed Site Settings ─────────────────

async function seedSiteSettings() {
  console.log('\n⚙️  Seeding site settings...');

  await apiPatchGlobal('site-settings', {
    shopName: "Joe's Garage",
    address: '335 8 St SW, Calgary, AB',
    phone: '(403) 874-8189',
    email: 'info@joes-garage.ca',
    hours: [
      { day: 'Monday', open: '10:00 AM', close: '6:00 PM' },
      { day: 'Tuesday', open: '10:00 AM', close: '6:00 PM' },
      { day: 'Wednesday', open: '10:00 AM', close: '6:00 PM' },
      { day: 'Thursday', open: '10:00 AM', close: '6:00 PM' },
      { day: 'Friday', open: '10:00 AM', close: '6:00 PM' },
      { day: 'Saturday', open: '10:00 AM', close: '5:00 PM' },
      { day: 'Sunday', open: 'Closed', close: 'Closed' },
    ],
    socialLinks: [
      { platform: 'Facebook', url: 'https://facebook.com/joesgarageyyc' },
      { platform: 'Instagram', url: 'https://instagram.com/joesgarageyyc' },
    ],
  });

  console.log('  ✓ Site settings updated');
}

// ─── Phase 6: Create Pages ───────────────────────

async function seedPages(mediaIds: MediaIds) {
  console.log('\n📄 Creating pages...');

  // Check which pages already exist by slug (so we don't skip all pages just because one exists)
  const existingPages = await apiGet('/pages?limit=100');
  const existingSlugs = new Set(existingPages.docs.map((p: any) => p.slug));
  const slugsToCreate = ['home', 'services', 'about', 'gallery', 'contact'].filter(s => !existingSlugs.has(s));
  if (slugsToCreate.length === 0) {
    console.log(`  All pages already exist, skipping.`);
    return;
  }
  console.log(`  Creating pages: ${slugsToCreate.join(', ')}`);

  // Get testimonial IDs for the testimonials block
  const testimonialsData = await apiGet('/testimonials?limit=10');
  const testimonialIds = testimonialsData.docs.map((t: any) => t.id);

  // ── Homepage ──
  if (slugsToCreate.includes('home')) await apiPost('/pages', {
    title: 'Home',
    slug: 'home',
    layout: [
      {
        blockType: 'logoHero',
        eyebrow: 'Bow River Pathway — Since 2007',
        heading: "Calgary's Shipping Container",
        headingAccent: 'Bike Shop.',
        subtitle: "Expert repairs, quality rentals, and honest advice — all from a steel shipping container right on the Bow River pathway.",
        ctaButtons: [
          { text: 'Book a Rental', link: '/book', style: 'primary' },
          { text: 'View Services', link: '/services', style: 'secondary' },
        ],
        trustIndicators: [
          { text: '5-Star Reviews' },
          { text: '30+ Years Experience' },
          { text: 'Louise Bridge, Bow River' },
        ],
      },
      {
        blockType: 'featureCards',
        eyebrow: 'What We Do',
        heading: 'Everything Two Wheels',
        subtitle: "From a flat tire to a full fleet rental, we've got you covered.",
        cards: [
          {
            title: 'Expert Repairs',
            description: "Tune-ups, brake adjustments, wheel truing, full overhauls — we fix it right the first time.",
            icon: 'star',
            link: '/services',
            linkText: 'View services',
            featured: false,
          },
          {
            title: 'Bike Rentals',
            description: 'Quality bikes for every adventure. Book online in minutes, sign your waiver digitally, and ride away.',
            icon: 'clock',
            link: '/book',
            linkText: 'Book now',
            featured: true,
          },
          {
            title: 'Honest Advice',
            description: "Not sure what you need? Joe's been at this for 30+ years. Drop by for a no-pressure chat about your ride.",
            icon: 'chat',
            link: '/contact',
            linkText: 'Get in touch',
            featured: false,
          },
        ],
      },
      {
        blockType: 'steps',
        eyebrow: 'Simple Process',
        heading: 'Book in 4 Easy Steps',
        subtitle: "From dates to riding — the whole thing takes about 5 minutes.",
        steps: [
          { title: 'Pick Your Dates', description: 'Choose your rental start and end dates on the calendar.' },
          { title: 'Choose Your Bike', description: 'Browse available bikes and select the one that fits.' },
          { title: 'Sign the Waiver', description: 'Quick digital waiver — sign on your phone or computer.' },
          { title: 'Pay & Ride', description: 'Secure payment, instant confirmation. Show up and ride!' },
        ],
        ctaText: 'Start Booking',
        ctaLink: '/book',
      },
      {
        blockType: 'sideBySide',
        image: mediaIds.containerExterior || undefined,
        imagePosition: 'left',
        content: {
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', text: "Joe started with a bike trailer and a city permit in 2007. Then came the cargo bike, a 1981 GMC delivery truck, and finally — a steel shipping container equipped with a propane heater, right on the Bow River pathway southeast of the Louise Bridge." }],
              },
              {
                type: 'paragraph',
                children: [{ type: 'text', text: "No fancy storefront, no overhead. Just 30+ years of experience, right where Calgary's cyclists actually ride." }],
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            version: 1,
          },
        },
      },
      {
        blockType: 'testimonials',
        heading: 'Riders Love Joe\'s',
        testimonials: testimonialIds,
      },
      {
        blockType: 'cta',
        heading: 'Ready to ride?',
        buttonText: 'Book a Rental',
        buttonLink: '/book',
        content: {
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', text: 'Book your rental online in minutes, or find us on the Bow River pathway just southeast of the Louise Bridge.' }],
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            version: 1,
          },
        },
      },
    ],
    meta: {
      title: "Joe's Garage — Calgary's Shipping Container Bike Shop",
      description: "Expert bicycle repairs, quality rentals, and honest advice since 2007. Book your rental online today.",
    },
  });
  if (slugsToCreate.includes('home')) console.log('  ✓ Homepage');

  // ── Services ──
  if (slugsToCreate.includes('services')) await apiPost('/pages', {
    title: 'Services',
    slug: 'services',
    layout: [
      {
        blockType: 'pageHeader',
        eyebrow: 'Repair Services',
        heading: 'We fix bikes.',
        headingAccent: 'Properly.',
        subtitle: "No shortcuts, no mystery charges. Just quality work at prices that make sense. Most repairs done same-day.",
      },
      {
        blockType: 'servicesGrid',
        noteText: '<strong class="text-ink">Prices are starting estimates.</strong> We\'ll always give you a firm quote before starting any work. Parts are extra where needed. Drop by or call <a href="tel:+14038748189" class="text-amber hover:text-amber-dark font-medium">(403) 874-8189</a> for a quote.',
      },
      {
        blockType: 'cta',
        heading: 'Need a repair?',
        buttonText: 'Call Joe',
        buttonLink: 'tel:+14038748189',
        content: {
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', text: 'Walk-ins welcome. For bigger jobs, give us a call first so we can plan the parts.' }],
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            version: 1,
          },
        },
      },
    ],
    meta: {
      title: 'Bike Repair Services — Joe\'s Garage',
      description: "Bike repair services at Joe's Garage, Calgary. Tune-ups, flat repairs, overhauls, wheel truing, and more. Fair prices, honest work.",
    },
  });
  if (slugsToCreate.includes('services')) console.log('  ✓ Services');

  // ── About ──
  if (slugsToCreate.includes('about')) await apiPost('/pages', {
    title: 'About',
    slug: 'about',
    layout: [
      {
        blockType: 'pageHeader',
        eyebrow: 'About Joe\'s Garage',
        heading: 'A bike trailer, a shipping container,',
        headingAccent: 'and 30 years of grease.',
        subtitle: "The story of how Joe Nunn turned a spot on the Bow River pathway into Calgary's favourite bike shop.",
      },
      ...(mediaIds.joePortrait ? [{
        blockType: 'sideBySide',
        image: mediaIds.joePortrait,
        imagePosition: 'left',
        content: {
          root: {
            type: 'root',
            children: [
              {
                type: 'heading',
                tag: 'h2',
                children: [{ type: 'text', text: 'From Bike Trailer to Bow River Landmark' }],
                direction: 'ltr',
                format: '',
                indent: 0,
                version: 1,
              },
              {
                type: 'paragraph',
                children: [
                  { type: 'text', text: 'Joe Nunn has been fixing bikes for ' },
                  { type: 'text', text: 'over 30 years', format: 1 },
                  { type: 'text', text: '. In 2007, he started Joe\'s Garage with nothing but a bike trailer, some tools, and a permit from the City of Calgary.' },
                ],
              },
              {
                type: 'paragraph',
                children: [
                  { type: 'text', text: 'The trailer became a cargo bike. The cargo bike became a 1981 GMC Grumman Kurbmaster delivery truck. And in 2019, Joe upgraded to a ' },
                  { type: 'text', text: 'steel shipping container', format: 1 },
                  { type: 'text', text: ' right on the pathway, equipped with a propane heater.' },
                ],
              },
              {
                type: 'paragraph',
                children: [{ type: 'text', text: "No upselling, no jargon, no attitude. Just a guy who genuinely loves bikes and wants to keep Calgary rolling." }],
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            version: 1,
          },
        },
      }] : []),
      {
        blockType: 'stats',
        stats: [
          { value: '2007', label: 'Est. on the pathway' },
          { value: '30', suffix: '+', label: 'Years wrenching' },
          { value: '5', suffix: '★', label: 'Google Reviews' },
        ],
      },
      {
        blockType: 'timeline',
        heading: 'The Evolution of Joe\'s Garage',
        milestones: [
          { year: '2007', title: 'The Bike Trailer', description: 'Joe gets a city permit, loads up a bike trailer with tools, and sets up on the Bow River pathway.', highlighted: false },
          { year: '2010s', title: 'The Cargo Bike', description: 'Business grows. Joe upgrades to a cargo bike, then a 1981 GMC Grumman Kurbmaster delivery truck.', highlighted: false },
          { year: '2019', title: 'The Shipping Container', description: "The steel shipping container arrives. With a propane heater, Joe's Garage can now run year-round.", highlighted: false },
          { year: 'Today', title: 'Rentals & Repairs', description: "Full bike rental fleet, online booking, digital waivers, and the same honest repair service Joe's known for.", highlighted: true },
        ],
      },
      {
        blockType: 'valuesGrid',
        heading: 'How We Roll',
        values: [
          { title: 'Honest Work', description: "We tell you what your bike needs — and what it doesn't. No surprise charges, no unnecessary repairs.", icon: 'shield' },
          { title: 'Quality First', description: "Every repair and every rental bike gets the same attention. We're not happy until it rides perfect.", icon: 'star' },
          { title: 'Community Driven', description: "A Bow River pathway fixture since 2007. We're proud to be part of Calgary's cycling community.", icon: 'people' },
        ],
      },
      {
        blockType: 'cta',
        heading: 'Come say hi',
        buttonText: 'Get Directions',
        buttonLink: '/contact',
        content: {
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', text: "Find us on the Bow River pathway, just southeast of the Louise Bridge. Drop by anytime during shop hours — Joe's always happy to talk bikes." }],
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            version: 1,
          },
        },
      },
    ],
    meta: {
      title: 'About Joe\'s Garage — Calgary Bike Shop Since 2007',
      description: "Meet Joe Nunn — the mechanic behind Joe's Garage. Operating from a shipping container on the Bow River pathway since 2007.",
    },
  });
  if (slugsToCreate.includes('about')) console.log('  ✓ About');

  // ── Gallery ──
  const galleryImages = [
    mediaIds.containerExterior,
    mediaIds.joeWorking,
    mediaIds.toolsCloseup,
    mediaIds.setup32,
    mediaIds.setup59,
    mediaIds.setup72,
    mediaIds.groupPhoto,
    mediaIds.kidsBikes,
    mediaIds.detoursFeature,
    mediaIds.gallery2011a,
    mediaIds.gallery2011b,
    mediaIds.gallery2011c,
    mediaIds.gallery2012a,
    mediaIds.toolsWide,
    mediaIds.joeCloseup,
  ].filter(Boolean);

  if (slugsToCreate.includes('gallery')) await apiPost('/pages', {
    title: 'Gallery',
    slug: 'gallery',
    layout: [
      {
        blockType: 'pageHeader',
        eyebrow: 'Photos',
        heading: 'The Shop',
        subtitle: "A look inside — and outside — Joe's Garage on the Bow River pathway.",
      },
      {
        blockType: 'gallery',
        images: galleryImages.map((id) => ({ image: id })),
      },
    ],
    meta: {
      title: "Gallery — Joe's Garage",
      description: "Photos of Joe's Garage — the shipping container bike shop on Calgary's Bow River pathway.",
    },
  });
  if (slugsToCreate.includes('gallery')) console.log('  ✓ Gallery');

  // ── Contact ──
  if (slugsToCreate.includes('contact')) await apiPost('/pages', {
    title: 'Contact',
    slug: 'contact',
    layout: [
      {
        blockType: 'pageHeader',
        eyebrow: 'Contact',
        heading: 'Come on',
        headingAccent: 'in.',
        subtitle: 'Walk-ins are always welcome. For bigger jobs, give us a ring first.',
      },
      {
        blockType: 'contactSection',
        showForm: true,
        infoItems: [
          { icon: 'mapPin', label: '335 8 St SW', sublabel: 'Calgary, AB', href: 'https://maps.app.goo.gl/J1D7gmAV4jtRKa137' },
          { icon: 'phone', label: '(403) 874-8189', sublabel: 'Call or text', href: 'tel:+14038748189' },
          { icon: 'email', label: 'info@joes-garage.ca', sublabel: "We'll get back to you within a day", href: 'mailto:info@joes-garage.ca' },
        ],
        hours: [
          { days: 'Monday – Friday', hours: '10:00 AM – 6:00 PM' },
          { days: 'Saturday', hours: '10:00 AM – 5:00 PM' },
          { days: 'Sunday', hours: 'Closed' },
        ],
        socialLinks: [
          { platform: 'facebook', url: 'https://facebook.com/joesgarageyyc' },
          { platform: 'instagram', url: 'https://instagram.com/joesgarageyyc' },
        ],
      },
      {
        blockType: 'mapEmbed',
        embedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2508.5!2d-114.0823453!3d51.0506619!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x53716fe596b443d9%3A0x5f4c539560c88155!2s335%208%20St%20SW%2C%20Calgary%2C%20AB!5e0!3m2!1sen!2sca!4v1700000000000!5m2!1sen!2sca',
        address: '335 8 St SW, Calgary, AB',
        height: 450,
      },
    ],
    meta: {
      title: "Contact Joe's Garage — Calgary Bike Shop",
      description: "Visit Joe's Garage at 335 8 St SW, Calgary. Call (403) 874-8189, or send us a message. Walk-ins always welcome.",
    },
  });
  if (slugsToCreate.includes('contact')) console.log('  ✓ Contact');
}

// ─── Main ────────────────────────────────────────

async function main() {
  console.log("🌱 Joe's Garage CMS Seed Script");
  console.log(`   Target: ${PAYLOAD_URL}`);
  console.log('');

  try {
    // Login
    console.log('🔐 Logging in...');
    token = await login();
    console.log('  ✓ Authenticated');

    // Upload photos
    const mediaIds = await uploadPhotos();

    // Seed collections
    await seedServices();
    await seedBikes(mediaIds);
    await seedTestimonials();

    // Seed globals
    await seedSiteSettings();

    // Create pages
    await seedPages(mediaIds);

    console.log('\n✅ Seed complete! All content has been created.');
    console.log('   Visit the admin panel to review: ' + PAYLOAD_URL + '/admin');
  } catch (err) {
    console.error('\n❌ Seed failed:', err);
    process.exit(1);
  }
}

main();

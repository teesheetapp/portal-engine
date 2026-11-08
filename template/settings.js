// =====================================================================
//  Copy this folder for each new builder, then work through every setting below.
//  Phases, draws, glossary, and warranty start from a typical luxury custom build: rewrite them in this builder's words.
//  NEW BUILDER — portal settings (start here)
//  Everything that makes this portal theirs lives here (and in theme.css and logos/).
//  The portal engine itself is loaded from the shared engine (see index.html).
// =====================================================================
window.PORTAL = {
  supabaseUrl: "https://nsftiohfzboovyyzijbu.supabase.co" /* shared portal database */,
  supabaseKey: "sb_publishable_g2jG6-WShPhdRIQ9_ZRi9A_vybxudXj",

  builder: {
  slug: "examplehomes"   /* must match this builder's row in the builders table */,
  name: "Example",
  fullName: "Example Homes",
  wordmarkSub: "Client portal",
  tagline: "Their tagline",
  logo: { onLight: "logos/logo-dark.png", onDark: "logos/logo-light.png" }, // dark lettering for light backgrounds, light for dark

  fonts: {
    href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Jost:wght@300;400;500;600&display=swap",
    display: '"Cormorant Garamond","Cormorant","Garamond","Times New Roman",serif',
    body: '"Jost","Futura","Avenir Next",system-ui,sans-serif',
  },

  // hero = the dark band on the overview; accent = small caps labels, highlights
  colors: {
    light: { bg: "#F1F0EC", surface: "#FAFAF8", surface2: "#E6E4DE", ink: "#1F2123", muted: "#67696B", line: "#D7D4CC",
             hero: "#2A2D2F", hero2: "#3A3E41", heroInk: "#EFECE5", heroMuted: "#A9ABA9",
             accent: "#7D6744", accentBright: "#C2AA7E", accentSoft: "#ECE5D6", btn: "#2A2D2F", btnInk: "#F4F1E9" },
    dark:  { bg: "#151718", surface: "#1C1F21", surface2: "#25292B", ink: "#ECE9E2", muted: "#9EA1A2", line: "#31363A",
             hero: "#0F1112", hero2: "#2A2E31", heroInk: "#ECE9E2", heroMuted: "#9A9D9E",
             accent: "#C9B184", accentBright: "#D6BF94", accentSoft: "#2C281F", btn: "#C9B184", btnInk: "#151718" },
  },

  // Their words for things
  labels: {
    client: "Client",
    projectLead: "Project manager",
    designCenter: "Design Center",
    designLead: "Design Center",
    finalTour: "Pre-close tour",
    closing: "The Closing",
    daysUntil: "Days until your closing",
  },

  // Build phases copied into every new home. days = typical length, used to draft dates.
  // moment = the headline on the shareable card when the phase is complete.
  phases: [
    { name: "Homesite discovery & design services", moment: "The design is final", days: 60,
      what: "Your homesite chosen with our real estate and construction team, then your home designed with our design, construction, and architecture team, from concept through permit.",
      look: "Nothing on site yet. Your plan set and design documents are in Documents.",
      decisions: "Homesite, final plan sign-off, exterior palette, and the agreement and allowance schedule." },
    { name: "Site preparation", moment: "Ground is broken", days: 25,
      what: "Clearing, grading, erosion control, utilities, and the house staked from the survey.",
      look: "Tree protection, the staked footprint, and the views from the main rooms.",
      decisions: "A staking walk to confirm the house sits exactly where you want it." },
    { name: "Foundation", moment: "The foundation is in", days: 30,
      what: "Footings, foundation walls, waterproofing and drainage, and slabs.",
      look: "The footing inspection card on the permit board and plumbing stubbed through the slab.",
      decisions: "Exterior outlet, hose bib, and landscape lighting conduit locations." },
    { name: "Framing", moment: "We’re framed", days: 35,
      what: "Floor system, walls, beams, roof framing, and sheathing. Rooms become real.",
      look: "Ceiling heights, window placement, and the scale of each room. Bring a tape measure for furnishings.",
      decisions: "Your post-framing & pre rough-in walk-through: we meet on site to confirm electrical, mechanical, and plumbing requirements before rough-ins begin." },
    { name: "Roof, windows & exterior envelope", moment: "Dried in", days: 20,
      what: "Roofing, flashing and gutters, windows and exterior doors, and the weather barrier.",
      look: "The house is now dried in. The interior stays protected from here on.",
      decisions: "Roofing and window finishes, confirmed during design." },
    { name: "Mechanical, electrical & plumbing rough-ins", moment: "Systems are in", days: 30,
      what: "Plumbing, wiring, HVAC, lighting control, audio, security, and network cabling run inside the open walls, ending with the county inspection.",
      look: "Switch and outlet locations, speaker locations, shower valve heights, recessed lighting layout.",
      decisions: "Outlet and TV locations, lighting scenes, speaker zones. Changes after insulation are far more involved." },
    { name: "Insulation & drywall", moment: "The walls are up", days: 40,
      what: "Insulation installed and inspected, then drywall hung and finished.",
      look: "Before insulation we photograph every wall, so you always know what's behind it.",
      decisions: "Your pre-insulation walkthrough. After this, what's in the walls is set." },
    { name: "Interior finishes", moment: "Finishes are in", days: 100,
      what: "Cabinetry, trim, stone, flooring, tile, paint, fixtures, and lighting.",
      look: "Your Design Center selections arriving and being installed. Note anything you'd like adjusted.",
      decisions: "All remaining selections finalized before fabrication is scheduled." },
    { name: "Exterior & landscape", moment: "The grounds are complete", days: 60,
      what: "Hardscape, driveway, final grading, irrigation, and landscaping.",
      look: "Terrace levels, drainage away from the house, landscape lighting at dusk.",
      decisions: "Planting palette, exterior lighting, and outdoor living details." },
    { name: "Pre-close tour & the closing", moment: "Welcome home", days: 18,
      what: "Final quality-control inspections and punch lists, then your pre-close tour of systems, finishes, and construction quality. At the closing you receive your photo diary, home information manual, warranty booklet, and keys.",
      look: "Everything. Your punch list is finalized from this tour.",
      decisions: "Your pre-close tour with your project manager, and the closing." },
  ],

  draws: [
    { name: "Agreement & deposit", percent: 10 },
    { name: "Foundation complete", percent: 15 },
    { name: "Framing & dry-in", percent: 20 },
    { name: "Rough-ins complete", percent: 15 },
    { name: "Insulation & drywall", percent: 10 },
    { name: "Interior finishes", percent: 20 },
    { name: "The Closing", percent: 10 },
  ],

  // Rooms suggested when photographing walls (the PM can type any other room)
  wallRooms: ["Kitchen", "Scullery", "Great room", "Dining room", "Library", "Primary bedroom", "Primary bath", "Primary closet",
    "Bedroom 2", "Bedroom 3", "Bedroom 4", "Guest suite", "Hall bath", "Powder room", "Laundry", "Mudroom", "Wine room",
    "Foyer", "Stair hall", "Bonus room", "Garage", "Attic", "Mechanical room"],
  wallSystems: ["Plumbing", "Electrical", "HVAC", "Low-voltage", "Blocking"],

  // Areas a home's work can be split into. Anything not assigned on a home goes to its project manager.
  duties: [["selections", "Selections & Design Center"], ["manual", "Home manual"], ["walls", "Wall photos"], ["visits", "Visit requests"],
    ["notes", "Client notes"], ["warranty", "Warranty"], ["finance", "Draws & invoices"]],

  // Note from the PM at the top of the overview. It's optional.
  // nudgeDays: remind the PM when the note is this old (0 = never). hideAfterDays: clients stop seeing an old note (0 = never).
  pmNote: { nudgeDays: 0, hideAfterDays: 45 },

  // Home manual: categories in the order shown, the essentials every home should list,
  // and the care note pre-filled for each category (the team can edit it per item).
  manualCategories: ["Paint", "Flooring", "Tile & stone", "Countertops", "Cabinetry", "Plumbing fixtures", "Lighting",
    "Appliances", "Hardware", "Windows & doors", "Systems", "Exterior", "Other"],
  manualEssentials: ["Main water shut-off", "Electrical panel", "Gas shut-off", "HVAC filters", "Water heater",
    "Irrigation controller", "Network equipment", "Security panel", "Attic access", "Sump pump"],
  manualCare: {
    "Paint": "Keep the touch-up can labeled with the room. Spot-clean with a soft sponge and mild soap; avoid abrasive cleaners on flat finishes.",
    "Flooring": "Sweep or vacuum weekly and clean with a pH-neutral cleaner. Felt pads under furniture; wipe spills promptly. Keep humidity between 35 and 55 percent for wood.",
    "Tile & stone": "Clean with a pH-neutral stone cleaner. Avoid vinegar, citrus, and bleach on natural stone. Reseal grout and stone about once a year.",
    "Countertops": "Use cutting boards and trivets. Wipe with warm water and mild soap. Natural stone: wipe acidic spills (wine, citrus) right away and reseal yearly.",
    "Cabinetry": "Wipe with a soft, damp cloth and dry. Avoid harsh cleaners and let steam from appliances vent away from doors.",
    "Plumbing fixtures": "Clean with warm water and a soft cloth. Avoid abrasive or acidic cleaners, which can damage the finish. Clean aerators every few months.",
    "Lighting": "Turn off and let cool before cleaning. Dust with a dry microfiber cloth. Note the bulb type before replacing.",
    "Appliances": "Register the warranty with the manufacturer. Follow the manual for filters and cleaning cycles.",
    "Hardware": "Wipe with a soft, dry cloth. Living finishes (unlacquered brass, bronze) will patina naturally over time.",
    "Windows & doors": "Clean tracks and weep holes each spring. Lubricate hinges and locks yearly. Check exterior caulk and weatherstripping each fall.",
    "Systems": "Follow the service schedule in the manual. Replace filters on schedule and book an HVAC tune-up each spring and fall.",
    "Exterior": "Rinse siding and stone yearly. Clean gutters each spring and fall. Check caulk at windows and trim each fall.",
  },

  // Plain-English glossary. These words get a dotted underline wherever they appear in the portal;
  // tapping one explains it. "also" = other spellings to catch. "group" = where it sits on the Glossary page.
  glossary: [
    { term: "Plan set", also: ["construction drawings"], group: "Design & permits", def: "The full set of drawings the house is built from: floor plans, elevations (each side of the house), sections, and details. Every trade works from the same set." },
    { term: "Elevation", also: ["elevations"], group: "Design & permits", def: "A drawing of one side of the house, looking straight at it. It shows rooflines, windows, and exterior materials." },
    { term: "Permit", also: ["building permit"], group: "Design & permits", def: "The county's written approval to build. It's posted on site, and inspectors sign off on each stage against it." },
    { term: "Inspection", also: ["inspections", "county inspection"], group: "Design & permits", def: "A visit from the county inspector to confirm work meets code before it's covered up. The house can't move to the next stage until it passes." },
    { term: "Setback", also: ["setbacks"], group: "Design & permits", def: "The minimum distance the house must sit from property lines and the street, set by the county or neighborhood." },
    { term: "Survey", also: ["boundary survey"], group: "Site & foundation", def: "A licensed surveyor's map of the lot: boundaries, easements, slopes, and trees. Used to place the house exactly." },
    { term: "Staking", also: ["staked", "staking walk"], group: "Site & foundation", def: "Marking the corners of the house on the lot with stakes and string, so you can stand where each room will be before anything is dug." },
    { term: "Grading", also: ["final grading", "graded"], group: "Site & foundation", def: "Shaping the ground so water flows away from the house. Done roughly at the start and finished at the end with landscaping." },
    { term: "Erosion control", group: "Site & foundation", def: "Silt fencing and similar barriers that keep soil from washing off the lot during construction. Required by the county." },
    { term: "Footings", also: ["footing"], group: "Site & foundation", def: "The wide concrete base poured below ground that carries the weight of the house down into the soil." },
    { term: "Slab", also: ["slabs"], group: "Site & foundation", def: "A flat concrete floor poured on the ground, used for garages, basements, or the whole first floor." },
    { term: "Waterproofing", group: "Site & foundation", def: "Coatings and membranes on the outside of foundation walls that keep ground moisture out of the house." },
    { term: "Stubbed", also: ["stub-outs", "stubbed through"], group: "Site & foundation", def: "Pipes left sticking up through the slab or out of a wall, ready for the next stage to connect to." },
    { term: "Framing", also: ["framed"], group: "Framing & envelope", def: "The wood skeleton of the house: floors, walls, and roof. When framing is done, you can walk through every room." },
    { term: "Sheathing", group: "Framing & envelope", def: "Large panels nailed over the outside of the framing that stiffen the walls and roof and give the siding something to attach to." },
    { term: "Load-bearing", also: ["load-bearing wall"], group: "Framing & envelope", def: "A wall or beam that holds up the floor or roof above it. These can't be moved without an engineer." },
    { term: "Header", also: ["headers"], group: "Framing & envelope", def: "The beam over a window or door opening that carries the weight around it." },
    { term: "Blocking", group: "Framing & envelope", def: "Solid wood added between studs where something heavy will hang later: TVs, grab bars, floating vanities, heavy art. Photographed before drywall so you know where it is." },
    { term: "Dried in", also: ["dry-in", "dried-in"], group: "Framing & envelope", def: "The point when the roof, windows, and weather barrier are on, so rain can no longer get inside. Interior work can safely begin." },
    { term: "Weather barrier", also: ["house wrap"], group: "Framing & envelope", def: "A membrane wrapped around the house under the siding that sheds water but lets the walls breathe." },
    { term: "Flashing", group: "Framing & envelope", def: "Thin metal or membrane pieces at roof valleys, windows, and doors that direct water away from joints." },
    { term: "Rough-in", also: ["rough-ins", "rough in"], group: "Systems", def: "Running the pipes, wires, and ducts inside open walls before they're closed up. Fixtures and devices come much later, at \"trim-out.\"" },
    { term: "MEP", group: "Systems", def: "Short for mechanical (heating and cooling), electrical, and plumbing: the systems that run inside the walls." },
    { term: "HVAC", group: "Systems", def: "Heating, ventilation, and air conditioning: the equipment and ductwork that heat, cool, and move fresh air through the house." },
    { term: "Low-voltage", also: ["low voltage"], group: "Systems", def: "Wiring for network, audio, security, cameras, and lighting control. Separate from the regular electrical wiring." },
    { term: "Shower valve", also: ["valve heights"], group: "Systems", def: "The hidden control behind your shower handle. Its height and position are set at rough-in, so we confirm them with you." },
    { term: "Trim-out", also: ["trim out"], group: "Systems", def: "Installing the visible pieces at the end: light fixtures, switches, outlets, faucets, and vent covers." },
    { term: "Insulation", group: "Walls & finishes", def: "Material in the walls and attic that keeps the house comfortable and efficient. It's inspected before drywall goes up." },
    { term: "Drywall", group: "Walls & finishes", def: "The panels that form your walls and ceilings. Hung, taped, and finished smooth before paint. After this, what's inside the walls is set." },
    { term: "Millwork", group: "Walls & finishes", def: "Custom woodwork: cabinetry, built-ins, paneling, and decorative trim." },
    { term: "Trim", also: ["trim carpentry"], group: "Walls & finishes", def: "Baseboards, door and window casings, and crown moulding that finish the edges of each room." },
    { term: "Fabrication", group: "Walls & finishes", def: "Cutting and finishing countertops and other made-to-measure pieces. It starts only after selections are final and the space is measured." },
    { term: "Hardscape", group: "Exterior & landscape", def: "The built parts of the landscape: terraces, walkways, walls, and the driveway." },
    { term: "Irrigation", group: "Exterior & landscape", def: "The underground sprinkler system for lawn and plantings, on timed zones." },
    { term: "Punch list", also: ["punch lists"], group: "Closing", def: "The list of small items to finish or fix before closing: a paint touch-up, a sticking drawer. Built from your pre-close tour." },
    { term: "Certificate of occupancy", group: "Closing", def: "The county's final approval that the house is complete and safe to live in. Required before closing." },
    { term: "Allowance", also: ["allowances"], group: "Money & paperwork", def: "A budget set in your agreement for something you choose later, like lighting or tile. Choose under it and you're credited; over it and the difference is added." },
    { term: "Change order", also: ["change orders"], group: "Money & paperwork", def: "A signed change to the plan, price, or schedule after the agreement. Nothing changes until you sign it here." },
    { term: "Draw", also: ["draws"], group: "Money & paperwork", def: "A scheduled payment tied to a stage of construction, such as foundation complete. Your draw schedule is in Financials." },
    { term: "Selections", also: ["selection"], group: "Money & paperwork", def: "Your choices of finishes and fixtures: tile, lighting, plumbing fixtures, hardware. Each has a date it's needed by to keep the schedule." },
    { term: "Lead time", also: ["lead times"], group: "Money & paperwork", def: "How long an item takes to arrive after it's ordered. Long lead times are why some selections are needed early." },
  ],

  threads: ["Your project team", "Design Center"],
  documentFolders: ["Plans", "Permits & inspections", "Agreements", "Change orders", "Selections", "Invoices", "Warranty & manuals", "Lot & survey"],
  requestKinds: ["Private site visit", "Design Center session"],

  // Warranty service after move-in. phone falls back to the project manager's number.
  warrantyService: {
    response: "reply within one business day",
    urgent: "For an active water leak, no heat or air conditioning in extreme weather, or an electrical problem, call us right away.",
    emergency: "If you smell gas, leave the house and call 911 and your gas company first.",
    visit: "Eleven-month walkthrough",
    visitMonths: 11,
    windows: ["Morning, 8 to 12", "Afternoon, 12 to 4", "All day"],
    phone: "",
  },
  warranty: [["Workmanship & materials", "1 year"], ["Plumbing, electrical & mechanical systems", "2 years"], ["Structure", "10 years"]],
  aftercare: "At the closing you receive your photo diary of the construction, your home information manual, and your warranty booklet. This portal keeps all of it, along with every drawing, finish, and manual, for as long as you own the home.",
  office: { address: "Office address", hours: "By appointment only" },

    // ---- Which sections this builder uses (all on unless set to false) ----
    // questions, selections, changes, messages, diary, walls, manual, warranty,
    // calendar, budget (Financials), documents, walkthrough (Notes & aftercare), glossary, moments
    features: {},

    // ---- Look (optional) ----
    // corners: "square" | "soft" | "round"   hero: "band" | "light" | "photo"
    // density: "airy" | "compact"            headings: "caps" | "bold"   texture: "paper"
    theme: {},

    // ---- Sign-in page (optional): add a photo to get a split-screen welcome ----
    // signin: { photo: "logos/signin.jpg", headline: "Welcome <span class='ital'>home</span>", text: "…", caption: "…" },

    // ---- Rename sections (optional), e.g. { walkthrough: "Punch list" } ----
    // navLabels: {},

    // ---- Pages only this builder has (optional) ----
    // pages: [{ id: "process", label: "Our process", where: "more", who: "all", title: "How we <span class='ital'>build</span>", html: "<p>…</p>" }],
  },
};

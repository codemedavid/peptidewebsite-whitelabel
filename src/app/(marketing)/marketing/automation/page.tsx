import type { Metadata } from "next";
import Link from "next/link";
import {
  Sparkles,
  CheckCircle2,
  Bot,
  Send,
  X,
  Check,
  ShieldCheck,
} from "lucide-react";
import {
  Section,
  SectionHeading,
  Card,
  Cta,
  Eyebrow,
  IconBadge,
  SoftIcon,
  GRADIENT,
  GRADIENT_DEEP,
} from "@/marketing/funnel/components";
import { FaqAccordion } from "@/marketing/funnel/FaqAccordion";
import {
  HERO,
  PROBLEMS,
  COST_STEPS,
  COSTS,
  VISION,
  SOLUTION_CARDS,
  STEPS,
  BENEFITS,
  FEATURES,
  VALUE_STACK,
  VALUE_TOTAL,
  FAQS,
  COMPARE,
} from "@/marketing/funnel/content";

// Served from the apex (jonina.store/automation) — host-dependent, never cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Peptide Business Automation System — Stop Being Your Own Customer Support",
  description:
    "Automate the repetitive part of your peptide business. Display products, organize COAs, answer the same questions 24/7, and let only serious buyers reach you — so you can focus on growth.",
  openGraph: {
    title: "Stop Being The Customer Support Of Your Own Peptide Business",
    description:
      "A complete automation system that displays your products, organizes your info, and answers customers 24/7. Set up in days.",
    type: "website",
  },
};

const INTER =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap";

export default function AutomationFunnelPage() {
  return (
    <div
      className="min-h-screen scroll-smooth bg-white text-zinc-900 antialiased"
      style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif' }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={INTER} />

      <SiteHeader />

      <main>
        <Hero />
        <Problem />
        <HiddenCost />
        <RealProblem />
        <FutureVision />
        <Solution />
        <HowItWorks />
        <Benefits />
        <Features />
        <ValueStack />
        <FaqSection />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  );
}

/* ─────────────────────────────── Header ─────────────────────────────── */

function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-baseline gap-0.5 text-xl font-extrabold tracking-tight ${
        light ? "text-white" : "text-zinc-900"
      }`}
    >
      Pepweb
      <span className="bg-gradient-to-r from-[#e94b7d] to-[#b0345e] bg-clip-text text-transparent">
        .automate
      </span>
    </Link>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-100 bg-white/80 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm font-medium text-zinc-600 md:flex" aria-label="Primary">
          <a href="#problem" className="transition-colors hover:text-zinc-900">The Problem</a>
          <a href="#how" className="transition-colors hover:text-zinc-900">How It Works</a>
          <a href="#features" className="transition-colors hover:text-zinc-900">Features</a>
          <a href="#faq" className="transition-colors hover:text-zinc-900">FAQ</a>
        </nav>
        <Cta size="md" withArrow={false} className="shadow-rose-500/20">
          Buuin ang system
        </Cta>
      </div>
    </header>
  );
}

/* ─────────────────────────────── Hero ─────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 right-[-6rem] h-[34rem] w-[34rem] rounded-full bg-gradient-to-br from-rose-200/60 via-rose-100/40 to-transparent blur-3xl" />
        <div className="absolute left-[-8rem] top-48 h-[26rem] w-[26rem] rounded-full bg-gradient-to-tr from-fuchsia-100/50 to-transparent blur-3xl" />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:pb-28 lg:pt-20">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3.5 py-1.5 text-xs font-semibold text-[#c43768] ring-1 ring-rose-100">
            <Sparkles size={14} /> {HERO.chip}
          </span>

          <h1 className="mt-5 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-zinc-900 sm:text-5xl lg:text-[3.5rem]">
            {HERO.headline1}{" "}
            <span className="bg-gradient-to-br from-[#e94b7d] to-[#b0345e] bg-clip-text text-transparent">
              {HERO.headlineAccent}
            </span>
          </h1>

          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-zinc-600 sm:text-lg">
            {HERO.sub}
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Cta>{HERO.primaryCta}</Cta>
            <Cta href="#how" variant="ghost" withArrow={false}>
              {HERO.secondaryCta}
            </Cta>
          </div>

          <ul className="mt-8 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {HERO.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-zinc-700">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#e94b7d]" />
                {b}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-zinc-100 pt-6 text-xs font-medium text-zinc-500">
            {HERO.trust.map((t, i) => (
              <span key={t} className="inline-flex items-center gap-2">
                {i > 0 && <span aria-hidden className="hidden h-1 w-1 rounded-full bg-zinc-300 sm:inline-block" />}
                {t}
              </span>
            ))}
          </div>
        </div>

        <HeroArt />
      </div>
    </section>
  );
}

function HeroArt() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      {/* product mock card */}
      <div className="rotate-1 rounded-3xl border border-zinc-100 bg-white p-4 shadow-[0_30px_70px_rgba(176,52,94,0.18)]">
        <div className="mb-3 flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-rose-300" />
          <i className="h-2.5 w-2.5 rounded-full bg-rose-200" />
          <i className="h-2.5 w-2.5 rounded-full bg-rose-100" />
          <span className="ml-2 truncate rounded-md bg-zinc-50 px-2 py-1 text-[11px] text-zinc-500">
            yourbrand.store
          </span>
        </div>

        <div className={`flex min-h-[120px] flex-col justify-end rounded-2xl ${GRADIENT_DEEP} p-5 text-white`}>
          <span className="text-[11px] font-medium uppercase tracking-widest text-white/85">
            Research Peptides
          </span>
          <b className="text-lg font-bold leading-tight">Your Peptide Store</b>
          <span className="text-sm text-white/85">Browse the catalog →</span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2.5">
          {["BPC-157", "TB-500", "GHK-Cu"].map((p) => (
            <div key={p} className="rounded-xl border border-zinc-100 bg-zinc-50 p-2.5">
              <div className="mb-2 h-9 rounded-lg bg-rose-100/70" />
              <div className="text-[10px] font-semibold text-zinc-700">{p}</div>
              <div className="text-[10px] text-zinc-500">COA ready</div>
            </div>
          ))}
        </div>
      </div>

      {/* floating chips */}
      <div className="absolute -left-3 top-10 hidden rotate-[-4deg] items-center gap-2 rounded-2xl border border-zinc-100 bg-white px-3.5 py-2.5 shadow-lg sm:flex">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-[#c43768]">
          <Bot size={16} />
        </span>
        <div className="leading-tight">
          <div className="text-[11px] font-semibold text-zinc-900">Auto-answered</div>
          <div className="text-[10px] text-zinc-500">24/7, kahit tulog ka</div>
        </div>
      </div>

      <div className="absolute -bottom-4 right-0 flex rotate-[3deg] items-center gap-2 rounded-2xl border border-zinc-100 bg-white px-3.5 py-2.5 shadow-lg sm:-right-3">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${GRADIENT} text-white`}>
          <Send size={15} />
        </span>
        <div className="leading-tight">
          <div className="text-[11px] font-semibold text-zinc-900">New serious buyer</div>
          <div className="text-[10px] text-zinc-500">Ready to order</div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Problem ─────────────────────────────── */

function Problem() {
  return (
    <Section id="problem" className="bg-zinc-50/60">
      <SectionHeading
        eyebrow="Sound familiar?"
        title="Buong araw, customer support ka sa sarili mong business"
        subtitle="Maganda ang product mo. Pero sa halip na mag-grow, naka-upo ka sa chat — sinasagot ang parehong tanong, paulit-ulit, araw-araw."
      />
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {PROBLEMS.map((p) => (
          <Card key={p.title}>
            <SoftIcon icon={p.icon} />
            <h3 className="mt-4 text-lg font-semibold text-zinc-900">{p.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{p.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────── Hidden Cost ─────────────────────────────── */

function HiddenCost() {
  return (
    <Section>
      <SectionHeading
        eyebrow="The math nobody talks about"
        title={
          <>
            3 oras kada araw. <span className="text-[#c43768]">90 oras kada buwan.</span> Saan napupunta?
          </>
        }
        subtitle="Tingnan natin ang totoong gastos ng manwal na operasyon — hindi sa pera, kundi sa oras na hindi na babalik."
      />

      <div className="mt-12 grid items-stretch gap-4 sm:grid-cols-3">
        {COST_STEPS.map((s, i) => (
          <div
            key={s.value}
            className="relative rounded-3xl border border-zinc-100 bg-white p-7 text-center shadow-sm"
          >
            <div className="bg-gradient-to-br from-[#e94b7d] to-[#b0345e] bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl">
              {s.value}
            </div>
            <p className="mt-2 text-sm text-zinc-500">{s.label}</p>
            {i < COST_STEPS.length - 1 && (
              <span
                aria-hidden
                className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-2xl text-rose-300 sm:block"
              >
                →
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center text-base text-zinc-600">
        That&apos;s more than <span className="font-semibold text-zinc-900">six full weeks</span> of full-time
        work every year — spent answering questions a system could answer for you.
      </p>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {COSTS.map((c) => (
          <Card key={c.title}>
            <SoftIcon icon={c.icon} />
            <h3 className="mt-4 text-base font-semibold text-zinc-900">{c.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{c.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────── Real Problem ─────────────────────────────── */

function RealProblem() {
  return (
    <section className="px-5 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-zinc-950 px-6 py-20 sm:px-12 lg:py-28">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-[#b0345e]/30 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-3xl text-center">
          <Eyebrow tone="light">Let&apos;s be honest</Eyebrow>
          <h2 className="mt-4 text-balance text-3xl font-bold leading-[1.12] tracking-tight text-white sm:text-4xl lg:text-5xl">
            The problem isn&apos;t your product.
            <br />
            <span className="bg-gradient-to-r from-[#f687a8] to-[#e94b7d] bg-clip-text text-transparent">
              The problem is — ikaw ang system.
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-zinc-300 sm:text-lg">
            Sulit ka, legit ka, may COA ka. Pero lahat ng dumadaan — dumadaan sa&apos;yo. Ikaw ang catalog.
            Ikaw ang FAQ. Ikaw ang customer service. Ikaw ang stockroom.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-zinc-400 sm:text-lg">
            Ang totoo? Wala kang business — may trabaho kang hindi ka pwedeng mag-absent. Sa araw na
            tumigil kang mag-reply, doon din titigil ang benta.
          </p>
          <div className="mt-9">
            <Cta variant="light">Buuin natin ang system mo</Cta>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────── Future Vision ─────────────────────────────── */

function FutureVision() {
  return (
    <Section>
      <SectionHeading
        eyebrow="Imagine this"
        title="A business na gumagana kahit tulog ka"
        subtitle="Isipin mo ang umaga na walang backlog ng tanong — kundi listahan ng mga taong handa nang bumili."
      />
      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        {VISION.map((v) => (
          <Card key={v.title} className="flex gap-4">
            <IconBadge icon={v.icon} className="shrink-0" />
            <div>
              <h3 className="text-lg font-semibold text-zinc-900">{v.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-500">{v.body}</p>
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────── Solution ─────────────────────────────── */

function Solution() {
  return (
    <Section className="bg-zinc-50/60">
      <SectionHeading
        eyebrow="Introducing"
        title="The Peptide Business Automation System"
        subtitle="Hindi lang website. Hindi lang software. It’s a digital employee na nagtatrabaho 24/7 — hindi humihingi ng off, hindi nagkakasakit, hindi nagrereklamo."
      />
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {SOLUTION_CARDS.map((c) => (
          <Card key={c.title}>
            <IconBadge icon={c.icon} />
            <h3 className="mt-5 text-lg font-semibold text-zinc-900">{c.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{c.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────── How It Works ─────────────────────────────── */

function HowItWorks() {
  return (
    <Section id="how" width="narrow">
      <SectionHeading
        eyebrow="How it works"
        title="Limang hakbang, zero paulit-ulit"
        subtitle="Ito ang dadaanan ng bawat customer mo — kusang gumagana, kahit wala ka."
        className="!max-w-2xl"
      />
      <ol className="relative mt-12">
        <span aria-hidden className="absolute left-[1.45rem] top-3 bottom-3 w-px bg-gradient-to-b from-rose-200 via-rose-200 to-transparent" />
        {STEPS.map((s) => (
          <li key={s.n} className="relative flex gap-5 pb-8 last:pb-0">
            <span
              className={`relative z-10 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${GRADIENT} text-sm font-bold text-white shadow-md shadow-rose-500/25`}
            >
              {s.n}
            </span>
            <div className="pt-1.5">
              <h3 className="text-lg font-semibold text-zinc-900">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-500">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-12 text-center">
        <Cta>Buuin natin ang system mo</Cta>
      </div>
    </Section>
  );
}

/* ─────────────────────────────── Benefits ─────────────────────────────── */

function Benefits() {
  return (
    <Section className="bg-zinc-50/60">
      <SectionHeading
        eyebrow="Why it changes everything"
        title="Bawiin mo ang oras mo — at ang business mo"
        subtitle="Hindi lang ito tungkol sa convenience. Tungkol ito sa kung paano gumagana ang buong operasyon mo."
      />
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {BENEFITS.map((b) => (
          <Card key={b.title}>
            <SoftIcon icon={b.icon} />
            <h3 className="mt-4 text-lg font-semibold text-zinc-900">{b.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{b.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────── Features ─────────────────────────────── */

function Features() {
  return (
    <Section id="features">
      <SectionHeading
        eyebrow="What's inside"
        title="Everything your business needs, in one system"
        subtitle="Bawat tool na kailangan mo para magmukhang propesyonal at gumana nang mag-isa — nasa loob na."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {FEATURES.map((f) => (
          <Card key={f.title} className="!p-5">
            <SoftIcon icon={f.icon} />
            <h3 className="mt-4 text-[15px] font-semibold text-zinc-900">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{f.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────── Value Stack ─────────────────────────────── */

function ValueStack() {
  return (
    <Section className="border-t border-zinc-100">
      <SectionHeading
        eyebrow="What you're really getting"
        title="A complete system — built piece by piece"
        subtitle="Kung pagbubukud-bukurin at ipapagawa mo nang isa-isa, ganito ang halaga. Sa system na ito, sabay-sabay na silang lahat."
      />

      <div className="mx-auto mt-12 max-w-2xl overflow-hidden rounded-3xl border border-zinc-100 bg-white shadow-[0_18px_50px_rgba(24,24,27,0.06)]">
        <ul className="divide-y divide-zinc-100">
          {VALUE_STACK.map((v) => (
            <li key={v.item} className="flex items-center justify-between gap-4 px-6 py-4">
              <span className="flex items-center gap-3 text-sm font-medium text-zinc-700 sm:text-base">
                <CheckCircle2 size={18} className="shrink-0 text-[#e94b7d]" />
                {v.item}
              </span>
              <span className="shrink-0 text-sm text-zinc-500 line-through sm:text-base">{v.value}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-4 bg-zinc-50 px-6 py-5">
          <span className="text-sm font-semibold text-zinc-900 sm:text-base">Total value if built separately</span>
          <span className="text-xl font-extrabold tracking-tight text-zinc-900 sm:text-2xl">{VALUE_TOTAL}</span>
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-2xl text-center">
        <p className="text-pretty text-base text-zinc-600">
          Hindi mo kailangang gastusin ang ₱115,000 — at lalong hindi mo kailangang ibuhos ang{" "}
          <span className="font-semibold text-zinc-900">90 oras kada buwan</span>. Kunin ang custom quote
          mo in minutes, at makikita mo muna ang buong plano bago ka magdesisyon.
        </p>
        <div className="mt-7">
          <Cta size="lg">Get my system started</Cta>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          No tech skills needed · Done-for-you setup · Walang obligasyon ang pagsisimula
        </p>
      </div>
    </Section>
  );
}

/* ─────────────────────────────── FAQ ─────────────────────────────── */

function FaqSection() {
  return (
    <Section id="faq" className="bg-zinc-50/60">
      <SectionHeading eyebrow="Good to know" title="Mga tanong bago ka magsimula" align="center" />
      <div className="mt-12">
        <FaqAccordion items={FAQS} />
      </div>
    </Section>
  );
}

/* ─────────────────────────────── Final CTA ─────────────────────────────── */

function FinalCta() {
  return (
    <Section>
      <SectionHeading
        eyebrow="Your next move"
        title="Two ways forward. Choose your business."
        subtitle="Parehong negosyo, parehong produkto. Ang pagkakaiba? Kung may sistemang tumatakbo para sa’yo."
      />

      <div className="mx-auto mt-12 grid max-w-4xl gap-5 md:grid-cols-2">
        {/* manual */}
        <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-7">
          <h3 className="text-lg font-bold text-zinc-700">{COMPARE.manual.title}</h3>
          <ul className="mt-5 flex flex-col gap-3">
            {COMPARE.manual.points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm text-zinc-500">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-500">
                  <X size={13} strokeWidth={3} />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        {/* automated */}
        <div className="relative rounded-3xl border border-rose-200 bg-white p-7 shadow-[0_18px_50px_rgba(176,52,94,0.12)]">
          <span className={`absolute -top-3 left-7 rounded-full ${GRADIENT} px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-md`}>
            With the system
          </span>
          <h3 className="text-lg font-bold text-zinc-900">{COMPARE.automated.title}</h3>
          <ul className="mt-5 flex flex-col gap-3">
            {COMPARE.automated.points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm font-medium text-zinc-700">
                <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${GRADIENT} text-white`}>
                  <Check size={13} strokeWidth={3} />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-14 max-w-3xl">
        <div className={`relative overflow-hidden rounded-[2rem] ${GRADIENT_DEEP} px-6 py-14 text-center sm:px-12`}>
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.18),transparent_45%)]" />
          <div className="relative">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white ring-1 ring-white/25">
              <ShieldCheck size={14} /> Done-for-you · Built for PH peptide sellers
            </div>
            <h2 className="text-balance text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
              Tigilan mo nang maging 24/7 support.
              <br />
              Maging boss ka ulit.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-white">
              Sagutin ang ilang simpleng tanong tungkol sa business mo, at kami na ang bahala sa setup.
              Ilang minuto lang para magsimula.
            </p>
            <div className="mt-8">
              <Cta variant="light" size="lg">
                Get Started Today
              </Cta>
            </div>
            <p className="mt-4 text-xs text-white/85">
              Done-for-you · Set up in days · Walang coding · Walang obligasyon
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────────── Footer ─────────────────────────────── */

function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-zinc-100 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-12 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 text-sm leading-relaxed text-zinc-500">
            The automation system for peptide sellers — display, organize, and answer 24/7, so you can
            focus on growth instead of replies.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <Cta size="md">Start your system</Cta>
          <div className="flex items-center gap-5 text-sm text-zinc-500">
            <Link href="/" className="transition-colors hover:text-zinc-900">Home</Link>
            <a href="#faq" className="transition-colors hover:text-zinc-900">FAQ</a>
            <a href="#how" className="transition-colors hover:text-zinc-900">How It Works</a>
          </div>
        </div>
      </div>
      <div className="border-t border-zinc-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-5 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {year} Pepweb. All rights reserved.</span>
          <span>Built with care in the Philippines 🌸</span>
        </div>
      </div>
    </footer>
  );
}

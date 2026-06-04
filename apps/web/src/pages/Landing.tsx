import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowUpRight, Route, Layers, ShieldCheck, Wallet, Search, Check } from 'lucide-react'
import { LogoMark, Wordmark } from '../components/Logo'
import { ThemeToggle } from '../components/ThemeToggle'
import { PoweredBy } from '../components/PoweredBy'

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
}
const stagger = { animate: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } } }
const ease = [0.16, 1, 0.3, 1] as const

export function Landing() {
  return (
    <div className="relative flex min-h-screen flex-col">
      {/* ── Floating nav ── */}
      <header className="sticky top-0 z-50">
        <div className="mx-auto mt-3 flex h-14 w-[calc(100%-1.5rem)] max-w-6xl items-center justify-between rounded-2xl border border-border bg-background/70 px-4 backdrop-blur-xl">
          <Link to="/" className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <Wordmark className="text-[1.12rem]" />
          </Link>
          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#chains" className="transition-colors hover:text-foreground">Chains</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/app"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-semibold text-background transition-all hover:opacity-90"
            >
              Launch app <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-30%] h-[640px] w-[860px] -translate-x-1/2 opacity-80 blur-[90px]"
          style={{ background: 'radial-gradient(ellipse at center, var(--accent-dim), transparent 68%)' }}
        />
        <div className="mx-auto grid w-full max-w-6xl gap-14 px-6 pb-24 pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:pt-28">
          <motion.div variants={stagger} initial="initial" animate="animate">
            <motion.div
              variants={fadeUp}
              className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              </span>
              Live on Ethereum · BNB Chain · Ink
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="font-serif text-[clamp(3.2rem,7vw,5.5rem)] font-500 leading-[0.98] tracking-[-0.03em] text-foreground"
              style={{ fontWeight: 500 }}
            >
              Fair price,
              <br />
              <span className="italic text-gradient">found.</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mt-7 max-w-md text-lg leading-relaxed text-muted-foreground"
            >
              Aequi scans every pool, scores split and multi-hop routes, and settles
              atomically through 0x&nbsp;Settler — so you always trade at the best on-chain price.
            </motion.p>

            <motion.div variants={fadeUp} className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/app"
                className="group inline-flex h-12 items-center gap-2 rounded-xl bg-[var(--accent)] px-6 text-base font-semibold text-[var(--accent-contrast)] transition-all hover:translate-y-[-1px]"
                style={{ boxShadow: '0 14px 34px -14px var(--accent)' }}
              >
                Start trading
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#how"
                className="inline-flex h-12 items-center rounded-xl border border-border bg-card px-6 text-base font-semibold text-foreground transition-colors hover:border-foreground/30"
              >
                How it works
              </a>
            </motion.div>

            {/* Stat row — quiet credibility */}
            <motion.div variants={fadeUp} className="mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-border pt-6">
              {[
                ['3', 'Chains live'],
                ['V2–V4', 'Pool coverage'],
                ['0%', 'Protocol fee'],
              ].map(([n, l]) => (
                <div key={l}>
                  <div className="font-serif text-2xl font-medium text-foreground" style={{ fontWeight: 500 }}>{n}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{l}</div>
                </div>
              ))}
            </motion.div>
          </motion.div>

          {/* Floating quote card */}
          <motion.div
            initial={{ opacity: 0, y: 28, rotate: -1.5 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ duration: 0.7, ease, delay: 0.15 }}
            className="relative mx-auto w-full max-w-sm"
          >
            <div className="elevate rounded-3xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-serif text-base font-medium" style={{ fontWeight: 500 }}>Swap</span>
                <span className="font-mono-num text-[0.62rem] uppercase tracking-[0.18em] text-[var(--accent)]">best route</span>
              </div>
              <div className="rounded-2xl bg-[var(--bg-primary)] p-4">
                <div className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">You pay</div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-bold">ETH</span>
                  <span className="font-mono-num text-2xl">1.00</span>
                </div>
              </div>
              <div className="relative z-10 -my-2 flex justify-center">
                <div className="rounded-xl border-4 border-card bg-[var(--bg-elevated)] p-1.5 text-[var(--accent)]">
                  <ArrowRight className="h-3.5 w-3.5 rotate-90" />
                </div>
              </div>
              <div className="rounded-2xl bg-[var(--bg-primary)] p-4">
                <div className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">You receive</div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-bold">USDC</span>
                  <span className="font-mono-num text-2xl">2,081.4</span>
                </div>
              </div>
              <div className="mt-4 space-y-2 px-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Rate</span><span className="font-mono-num">1 ETH = 2,081.4</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Route</span><span className="font-mono-num text-[var(--accent)]">Uniswap V3 · direct</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">vs. market</span><span className="text-[var(--success)]">+0.31%</span></div>
              </div>
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] opacity-70 blur-3xl"
              style={{ background: 'radial-gradient(ellipse at 30% 10%, var(--accent-dim), transparent 70%)' }}
            />
          </motion.div>
        </div>
      </section>

      {/* ── Trust strip ── */}
      <section id="chains" className="border-y border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5 text-sm">
          <span className="text-muted-foreground">Powered by <span className="font-semibold text-foreground">0x Settler</span> · non-custodial · atomic settlement</span>
          <div className="flex items-center gap-7 font-medium text-foreground/70">
            <span>Ethereum</span><span>BNB Chain</span><span>Ink</span>
          </div>
        </div>
      </section>

      {/* ── Features (bento) ── */}
      <section id="features" className="mx-auto w-full max-w-6xl px-6 py-24">
        <motion.div variants={fadeUp} initial="initial" whileInView="animate" viewport={{ once: true }} className="mb-12 max-w-xl">
          <p className="mb-3 font-mono-num text-xs uppercase tracking-[0.2em] text-[var(--accent)]">Why Aequi</p>
          <h2 className="font-serif text-4xl leading-[1.05] tracking-tight text-foreground" style={{ fontWeight: 500 }}>
            The whole market, one router.
          </h2>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-80px' }}
          className="grid gap-4 md:grid-cols-6"
        >
          {/* large tile */}
          <motion.div variants={fadeUp} className="elevate group relative overflow-hidden rounded-3xl border border-border bg-card p-7 md:col-span-4 md:row-span-2">
            <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-dim)] text-[var(--accent)]">
              <Route className="h-5 w-5" />
            </div>
            <h3 className="font-serif text-2xl tracking-tight text-foreground" style={{ fontWeight: 500 }}>Best execution, proven</h3>
            <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-muted-foreground">
              Every pool is discovered, every split and multi-hop path scored for price, impact and gas —
              then the winning route is simulated before you ever sign. You see the math, not a black box.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {['Split routing', 'Multi-hop', 'Gas-aware', 'Pre-trade sim'].map((t) => (
                <span key={t} className="rounded-full border border-border bg-[var(--bg-primary)] px-3 py-1 text-xs font-medium text-muted-foreground">{t}</span>
              ))}
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-60 blur-3xl transition-opacity group-hover:opacity-90"
              style={{ background: 'radial-gradient(circle, var(--accent-dim), transparent 70%)' }}
            />
          </motion.div>

          <motion.div variants={fadeUp} className="elevate rounded-3xl border border-border bg-card p-7 md:col-span-2">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-dim)] text-[var(--accent)]"><Layers className="h-5 w-5" /></div>
            <h3 className="font-display text-lg font-bold text-foreground">Wide coverage</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Uniswap V2·V3·V4, PancakeSwap, Velodrome Slipstream.</p>
          </motion.div>

          <motion.div variants={fadeUp} className="elevate rounded-3xl border border-border bg-card p-7 md:col-span-2">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-dim)] text-[var(--accent)]"><ShieldCheck className="h-5 w-5" /></div>
            <h3 className="font-display text-lg font-bold text-foreground">Non-custodial</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Settled atomically via 0x Settler. Funds never rest in a middleman.</p>
          </motion.div>
        </motion.div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="border-t border-border bg-card/40">
        <div className="mx-auto w-full max-w-6xl px-6 py-24">
          <motion.div variants={fadeUp} initial="initial" whileInView="animate" viewport={{ once: true }} className="mb-12">
            <p className="mb-3 font-mono-num text-xs uppercase tracking-[0.2em] text-[var(--accent)]">How it works</p>
            <h2 className="font-serif text-4xl tracking-tight text-foreground" style={{ fontWeight: 500 }}>Three steps to best price</h2>
          </motion.div>
          <motion.div variants={stagger} initial="initial" whileInView="animate" viewport={{ once: true, margin: '-80px' }} className="grid gap-4 md:grid-cols-3">
            {[
              { n: '01', icon: Wallet, title: 'Connect', body: 'Connect your wallet on Ethereum, BNB Chain or Ink.' },
              { n: '02', icon: Search, title: 'Quote', body: 'Aequi discovers pools and scores the best route in real time.' },
              { n: '03', icon: Check, title: 'Swap', body: 'Approve once, then settle atomically through 0x Settler.' },
            ].map((s) => (
              <motion.div key={s.n} variants={fadeUp} className="rounded-3xl border border-border bg-card p-7">
                <div className="flex items-center justify-between">
                  <span className="font-mono-num text-sm font-bold text-[var(--accent)]">{s.n}</span>
                  <s.icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <h3 className="mt-5 font-display text-lg font-bold text-foreground">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Closing CTA ── */}
      <section className="relative mx-auto w-full max-w-6xl overflow-hidden px-6 py-28 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[400px] w-[700px] -translate-x-1/2 -translate-y-1/2 opacity-70 blur-[90px]"
          style={{ background: 'radial-gradient(ellipse at center, var(--accent-dim), transparent 70%)' }}
        />
        <motion.div variants={fadeUp} initial="initial" whileInView="animate" viewport={{ once: true }} className="relative">
          <h2 className="font-serif text-[clamp(2.6rem,6vw,4.5rem)] leading-[1.02] tracking-[-0.02em] text-foreground" style={{ fontWeight: 500 }}>
            Trade at the <span className="italic text-gradient">fair price.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-md text-lg text-muted-foreground">
            No spread games, no hidden middleman — just the best on-chain route, every time.
          </p>
          <Link
            to="/app"
            className="mt-9 inline-flex h-12 items-center gap-2 rounded-xl bg-[var(--accent)] px-7 text-base font-semibold text-[var(--accent-contrast)] transition-all hover:translate-y-[-1px]"
            style={{ boxShadow: '0 14px 34px -14px var(--accent)' }}
          >
            Launch Aequi <ArrowUpRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </section>

      <footer className="mt-auto border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-6 py-8 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <LogoMark size={20} />
            <Wordmark className="text-sm" />
            <span className="text-xs">— fair price, found.</span>
          </div>
          <PoweredBy />
        </div>
      </footer>
    </div>
  )
}

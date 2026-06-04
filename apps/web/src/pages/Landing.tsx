import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Route, Layers, ShieldCheck, Wallet, Search, Check } from 'lucide-react'
import { LogoMark, Wordmark } from '../components/Logo'
import { ThemeToggle } from '../components/ThemeToggle'
import { PoweredBy } from '../components/PoweredBy'

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
}

const stagger = {
  animate: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
}

export function Landing() {
  return (
    <div className="relative flex min-h-screen flex-col">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <LogoMark size={26} />
            <Wordmark className="text-[1.15rem]" />
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#chains" className="transition-colors hover:text-foreground">Chains</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/app"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition-all hover:brightness-110"
              style={{ boxShadow: '0 8px 22px -10px var(--accent)' }}
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
          className="pointer-events-none absolute inset-x-0 top-[-20%] mx-auto h-[520px] max-w-4xl opacity-70 blur-3xl"
          style={{ background: 'radial-gradient(ellipse at center, var(--accent-dim), transparent 70%)' }}
        />
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 pb-20 pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-28">
          <motion.div variants={stagger} initial="initial" animate="animate">
            <motion.div
              variants={fadeUp}
              className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              Live on Ethereum · BNB Chain · Ink
            </motion.div>
            <motion.h1
              variants={fadeUp}
              className="font-display text-5xl font-extrabold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-6xl"
            >
              Fair price,
              <br />
              <span className="text-gradient">found.</span>
            </motion.h1>
            <motion.p
              variants={fadeUp}
              className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground"
            >
              Aequi scans every pool, scores split and multi-hop routes, and settles
              atomically through 0x Settler — so you always trade at the best on-chain price.
            </motion.p>
            <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/app"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-[var(--accent)] px-6 text-base font-semibold text-[var(--accent-contrast)] transition-all hover:translate-y-[-1px] hover:brightness-110"
                style={{ boxShadow: '0 12px 30px -12px var(--accent)' }}
              >
                Start trading <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex h-12 items-center rounded-xl border border-border bg-card px-6 text-base font-semibold text-foreground transition-colors hover:border-[var(--accent)]"
              >
                How it works
              </a>
            </motion.div>
          </motion.div>

          {/* Floating quote card */}
          <motion.div
            initial={{ opacity: 0, y: 24, rotate: -1 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
            className="relative mx-auto w-full max-w-sm"
          >
            <div className="elevate rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-display text-sm font-bold">Swap</span>
                <span className="font-mono-num text-[0.65rem] uppercase tracking-widest text-[var(--accent)]">
                  best route
                </span>
              </div>
              <div className="rounded-xl bg-[var(--bg-primary)] p-4">
                <div className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">You pay</div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-bold">ETH</span>
                  <span className="font-mono-num text-2xl font-medium">1.00</span>
                </div>
              </div>
              <div className="my-1.5 flex justify-center">
                <div className="rounded-lg border border-border bg-card p-1.5 text-[var(--accent)]">
                  <ArrowRight className="h-3.5 w-3.5 rotate-90" />
                </div>
              </div>
              <div className="rounded-xl bg-[var(--bg-primary)] p-4">
                <div className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">You receive</div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-bold">USDC</span>
                  <span className="font-mono-num text-2xl font-medium">2,081.4</span>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between px-1 text-xs text-muted-foreground">
                <span>1 ETH = <span className="font-mono-num text-foreground">2,081.4</span></span>
                <span className="text-[var(--success)]">+0.3% vs market</span>
              </div>
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] opacity-60 blur-2xl"
              style={{ background: 'radial-gradient(ellipse at 30% 20%, var(--accent-dim), transparent 70%)' }}
            />
          </motion.div>
        </div>
      </section>

      {/* ── Trust strip ── */}
      <section id="chains" className="border-y border-border bg-card/40">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-6 px-5 py-6 text-sm text-muted-foreground">
          <span className="font-medium">Powered by 0x Settler · non-custodial · atomic</span>
          <div className="flex items-center gap-6 font-display font-semibold text-foreground/80">
            <span>Ethereum</span><span>BNB Chain</span><span>Ink</span>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="mx-auto w-full max-w-6xl px-5 py-20">
        <motion.div
          variants={stagger}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-80px' }}
          className="grid gap-5 md:grid-cols-3"
        >
          {[
            { icon: Route, title: 'Best execution', body: 'Split and multi-hop routing across every pool, scored for price, impact and gas — then verified before you sign.' },
            { icon: Layers, title: 'Wide coverage', body: 'Uniswap V2 · V3 · V4, PancakeSwap, and Velodrome Slipstream — one router, the whole market.' },
            { icon: ShieldCheck, title: 'Non-custodial', body: 'Settled atomically through 0x Settler. Your funds never rest in a middleman contract.' },
          ].map((f) => (
            <motion.div
              key={f.title}
              variants={fadeUp}
              className="elevate rounded-2xl border border-border bg-card p-6"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-dim)] text-[var(--accent)]">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-display text-lg font-bold text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="border-t border-border bg-card/40">
        <div className="mx-auto w-full max-w-6xl px-5 py-20">
          <motion.h2
            variants={fadeUp}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="font-display text-3xl font-extrabold tracking-tight text-foreground"
          >
            Three steps to best price
          </motion.h2>
          <motion.div
            variants={stagger}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: '-80px' }}
            className="mt-10 grid gap-5 md:grid-cols-3"
          >
            {[
              { n: '01', icon: Wallet, title: 'Connect', body: 'Connect your wallet on Ethereum, BNB Chain or Ink.' },
              { n: '02', icon: Search, title: 'Quote', body: 'Aequi discovers pools and scores the best route in real time.' },
              { n: '03', icon: Check, title: 'Swap', body: 'Approve once, then settle atomically through 0x Settler.' },
            ].map((s) => (
              <motion.div key={s.n} variants={fadeUp} className="rounded-2xl border border-border bg-card p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono-num text-sm font-bold text-[var(--accent)]">{s.n}</span>
                  <s.icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <h3 className="mt-4 font-display text-lg font-bold text-foreground">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Closing CTA ── */}
      <section className="mx-auto w-full max-w-6xl px-5 py-24 text-center">
        <motion.div variants={fadeUp} initial="initial" whileInView="animate" viewport={{ once: true }}>
          <h2 className="font-display text-4xl font-extrabold tracking-[-0.02em] text-foreground sm:text-5xl">
            Trade at the <span className="text-gradient">fair price.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-lg text-muted-foreground">
            No spread games, no hidden middleman. Just the best on-chain route, every time.
          </p>
          <Link
            to="/app"
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-[var(--accent)] px-7 text-base font-semibold text-[var(--accent-contrast)] transition-all hover:translate-y-[-1px] hover:brightness-110"
            style={{ boxShadow: '0 12px 30px -12px var(--accent)' }}
          >
            Launch Aequi <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </section>

      <footer className="mt-auto border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-5 py-8 sm:flex-row sm:justify-between">
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

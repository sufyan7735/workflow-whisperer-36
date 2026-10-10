import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, FileText, Search, Phone, MapPin, Sun, MessageCircle, Lock, Send, Bell, BellOff, Bot, User, Moon, Copy, Check, Clock, Download, StickyNote } from "lucide-react";

let audioCtx: AudioContext | null = null;
function playChime() {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    [880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.15;
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
  } catch { /* ignore */ }
}
import { STAGES, type Stage } from "@/lib/crm-data";
import { listCustomers, getMessages, sendMessage, saveNote, setBotPaused } from "@/lib/crm.functions";
import { Orders, useOrders } from "@/components/Orders";
import { Tickets, useTickets } from "@/components/Tickets";
import logo from "@/assets/actes-logo.png.asset.json";
import chatBg from "@/assets/actes-chat-bg.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ACTES — لوحة محادثات عملاء البوت" },
      { name: "description", content: "عرض أرقام ومحادثات جميع عملاء بوت واتساب ACTES للطاقة الشمسية." },
      { property: "og:title", content: "ACTES — لوحة محادثات عملاء البوت" },
      { property: "og:description", content: "متابعة العملاء وعروض الأسعار ومخططات SLD من مكان واحد." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const PW_KEY = "actes_pw";

const stageClass: Record<string, string> = {
  new: "bg-muted text-muted-foreground",
  quote: "bg-st-quote text-st-quote-fg",
  sld: "bg-st-sld text-st-sld-fg",
  cod: "bg-st-cod text-st-cod-fg",
  buy: "bg-st-buy text-st-buy-fg",
  human: "bg-st-human text-st-human-fg",
};

type SysT = "res" | "com" | "agri";
const SYS: Record<SysT, string> = { res: "🏠 سكني", com: "🏢 تجاري", agri: "🌾 زراعي" };
function sysType(s: string | null): SysT | null {
  if (!s) return null;
  if (/زراع|مضخ|غطاس|ري\b/.test(s)) return "agri";
  if (/تجار|مصنع|شرك|مؤسس/.test(s)) return "com";
  if (/سكن|منزل|بيت/.test(s)) return "res";
  return null;
}

function dayLabel(t: string) {
  const d = new Date(t); const n = new Date();
  if (d.toDateString() === n.toDateString()) return "اليوم";
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "أمس";
  return d.toLocaleDateString("ar", { day: "numeric", month: "long", year: d.getFullYear() === n.getFullYear() ? undefined : "numeric" });
}

function exportCsv(rows: { name: string | null; phone: string; city: string | null; stage: string; system: string | null; last_at: string; notes: string | null }[], orders: { phone: string; invoice_no: string | null; amount: string | null; status: string }[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const head = ["الاسم", "الرقم", "المدينة", "الحالة", "نوع المنظومة", "المنظومة", "الطلبات", "آخر نشاط", "ملاحظات"];
  const lines = rows.map((c) => {
    const d = c.phone.replace(/\D/g, "").slice(-9);
    const os = orders.filter((o) => o.phone.replace(/\D/g, "").endsWith(d)).map((o) => [o.invoice_no, o.amount, orderStatus[o.status] ?? o.status].filter(Boolean).join(" "));
    const t = sysType(c.system);
    return [c.name, "+" + c.phone.replace(/^\+/, ""), c.city, STAGES[c.stage as Stage] ?? c.stage, t ? SYS[t].slice(3) : "", c.system, os.join(" | "), new Date(c.last_at).toLocaleString("ar"), c.notes].map(esc).join(",");
  });
  const blob = new Blob(["\uFEFF" + [head.map(esc).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ACTES-عملاء-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function fmt(t: string) {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ar", { day: "numeric", month: "short" });
}

function Index() {
  const [pw, setPw] = useState<string | null>(null);
  useEffect(() => { setPw(localStorage.getItem(PW_KEY)); }, []);
  if (!pw) return <Login onOk={(p) => { localStorage.setItem(PW_KEY, p); setPw(p); }} />;
  return <Dashboard pw={pw} onLogout={() => { localStorage.removeItem(PW_KEY); setPw(null); }} />;
}

function Login({ onOk }: { onOk: (p: string) => void }) {
  const list = useServerFn(listCustomers);
  const [v, setV] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-background p-6">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setErr("");
          try { await list({ data: { pw: v } }); onOk(v); }
          catch { setErr("كلمة المرور غير صحيحة"); }
          finally { setBusy(false); }
        }}
      >
        <div className="flex flex-col items-center gap-1 text-primary"><img src={logo.url} alt="ACTES أكتس" className="h-20 w-auto" /><h1 className="text-xl font-bold">محادثات العملاء</h1></div>
        <label className="block text-sm text-muted-foreground">كلمة مرور اللوحة</label>
        <div className="relative">
          <Lock className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input type="password" value={v} onChange={(e) => setV(e.target.value)} className="w-full rounded-lg border border-input bg-background py-2 pl-3 pr-9 outline-none focus:ring-2 focus:ring-ring" />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <button disabled={busy || !v} className="w-full rounded-lg bg-primary py-2.5 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? "جاري الدخول..." : "دخول"}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ pw, onLogout }: { pw: string; onLogout: () => void }) {
  const list = useServerFn(listCustomers);
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: () => list({ data: { pw } }),
    refetchInterval: 10000,
  });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Stage | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"chats" | "orders" | "tickets">("chats");
  const { data: tickets = [] } = useTickets(pw);
  const openTickets = tickets.filter((t) => t.status === "open").length;
  const { data: orders = [] } = useOrders(pw);
  const pending = orders.filter((o) => o.status === "pending").length;

  const [city, setCity] = useState("");
  const [sys, setSys] = useState("");
  const cities = useMemo(() => [...new Set(customers.map((c) => (c.city ?? "").trim()).filter(Boolean))].sort(), [customers]);
  const shown = useMemo(() => customers.filter((c) =>
    (filter === "all" || c.stage === filter) &&
    (!city || (c.city ?? "").trim() === city) &&
    (!sys || sysType(c.system) === sys) &&
    ((c.name ?? "").includes(q) || c.phone.includes(q.replace(/\s/g, "")))), [customers, q, filter, city, sys]);
  const open = customers.find((c) => c.id === openId) ?? null;

  const [muted, setMuted] = useState(false);
  useEffect(() => { setMuted(localStorage.getItem("actes_mute") === "1"); }, []);
  const prevSig = useRef<{ unread: number; count: number } | null>(null);
  useEffect(() => {
    if (isLoading) return;
    const sig = { unread: customers.reduce((s, c) => s + (c.unread || 0), 0), count: customers.length };
    const p = prevSig.current;
    prevSig.current = sig;
    if (p && !muted && (sig.unread > p.unread || sig.count > p.count)) playChime();
  }, [customers, isLoading, muted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stats: { key: Stage | "all"; label: string; value: number }[] = [
    { key: "all", label: "العملاء", value: customers.length },
    { key: "quote" as Stage, label: "عروض أسعار", value: customers.filter((c) => c.stage === "quote").length },
    { key: "sld" as Stage, label: "مخططات SLD", value: customers.filter((c) => c.stage === "sld").length },
    { key: "cod" as Stage, label: "عند الاستلام", value: customers.filter((c) => c.stage === "cod").length },
    { key: "buy" as Stage, label: "جاهز للشراء", value: customers.filter((c) => c.stage === "buy").length },
  ];

  const [dark, setDark] = useState(false);
  useEffect(() => { const d = localStorage.getItem("actes_dark") === "1"; setDark(d); document.documentElement.classList.toggle("dark", d); }, []);
  const toggleDark = () => { const d = !dark; setDark(d); localStorage.setItem("actes_dark", d ? "1" : "0"); document.documentElement.classList.toggle("dark", d); };

  return (
    <div dir="rtl" className="flex h-screen bg-background text-foreground">
      <aside className="flex w-full flex-col">
        <header className="bg-primary px-4 pb-4 pt-5 text-primary-foreground">
          <div className="flex items-center gap-2">
            <img src={logo.url} alt="ACTES أكتس" className="h-9 w-auto rounded-md bg-card px-1" />
            <h1 className="flex-1 text-lg font-bold">محادثات العملاء</h1>
            <button onClick={toggleDark} aria-label={dark ? "الوضع الفاتح" : "الوضع الليلي"} title={dark ? "الوضع الفاتح" : "الوضع الليلي"}
              className="rounded-md p-1.5 hover:bg-primary-foreground/10">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => { const m = !muted; setMuted(m); localStorage.setItem("actes_mute", m ? "1" : "0"); if (!m) playChime(); }}
              aria-label={muted ? "تشغيل صوت التنبيه" : "كتم صوت التنبيه"}
              title={muted ? "تشغيل صوت التنبيه" : "كتم صوت التنبيه"}
              className="rounded-md p-1.5 hover:bg-primary-foreground/10">
              {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            </button>
            <button onClick={onLogout} className="text-xs opacity-80">خروج</button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-primary-foreground/10 p-1 text-sm">
            <button onClick={() => setView("chats")} className={`rounded-md py-1.5 ${view === "chats" ? "bg-card font-semibold text-foreground" : ""}`}>المحادثات</button>
            <button onClick={() => { setView("orders"); setOpenId(null); }} className={`relative rounded-md py-1.5 ${view === "orders" ? "bg-card font-semibold text-foreground" : ""}`}>
              الطلبات
              {pending > 0 && <span className="absolute -top-1 left-2 rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">{pending}</span>}
            </button>
            <button onClick={() => { setView("tickets"); setOpenId(null); }} className={`relative rounded-md py-1.5 ${view === "tickets" ? "bg-card font-semibold text-foreground" : ""}`}>
              الدعم الفني
              {openTickets > 0 && <span className="absolute -top-1 left-2 rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">{openTickets}</span>}
            </button>
          </div>
          {view === "chats" && <div className="mt-3 grid grid-cols-5 gap-1.5">
            {stats.map((s) => (
              <button key={s.label} onClick={() => setFilter(filter === s.key ? "all" : s.key)}
                className={`rounded-lg p-2 text-center transition-colors ${filter === s.key ? "bg-card text-foreground shadow" : "bg-primary-foreground/10 hover:bg-primary-foreground/20"}`}>
                <div className="text-xl font-bold">{s.value}</div>
                <div className="text-[10px] opacity-80">{s.label}</div>
              </button>
            ))}
          </div>}
        </header>
        {view === "orders" ? <Orders pw={pw} /> : view === "tickets" ? <Tickets pw={pw} /> : <>
        <div className="space-y-2 p-3">
          <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[10rem] flex-1">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الرقم"
              className="w-full rounded-lg border border-input bg-card py-2 pl-3 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="المدينة" className="rounded-lg border border-input bg-card px-2 py-2 text-sm">
            <option value="">كل المدن</option>
            {cities.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={sys} onChange={(e) => setSys(e.target.value)} aria-label="نوع المنظومة" className="rounded-lg border border-input bg-card px-2 py-2 text-sm">
            <option value="">كل الأنواع</option>
            {(Object.keys(SYS) as SysT[]).map((k) => <option key={k} value={k}>{SYS[k]}</option>)}
          </select>
          <button onClick={() => exportCsv(shown, orders)} title="تصدير إلى Excel" className="flex items-center gap-1 rounded-lg border border-input bg-card px-3 py-2 text-sm hover:bg-muted">
            <Download className="h-4 w-4" /><span className="hidden sm:inline">Excel</span>
          </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {(["all", ...Object.keys(STAGES)] as (Stage | "all")[]).map((s) => {
              const n = customers.filter((c) => c.unread > 0 && (s === "all" || c.stage === s)).length;
              return (
              <button key={s} onClick={() => setFilter(s)}
                className={`relative mt-2 shrink-0 rounded-full border px-3 py-1 text-xs ${filter === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>
                {s === "all" ? "الكل" : STAGES[s]}
                {n > 0 && <span className="absolute -top-2 -left-1 min-w-[18px] animate-pulse rounded-full bg-destructive px-1 text-[10px] font-bold leading-[18px] text-destructive-foreground">{n}</span>}
              </button>
            );})}
          </div>
        </div>
        <ul className="flex flex-1 flex-col overflow-y-auto">
          {shown.map((c) => (
            <li key={c.id}>
              <button onClick={() => setOpenId(c.id)}
                className={`flex w-full items-center gap-3 border-b border-border px-3 py-3 text-right hover:bg-muted ${openId === c.id ? "bg-muted" : ""}`}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-secondary-foreground">
                  {(c.name ?? "#")[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2"><span className="truncate font-semibold">{c.name || c.phone}</span>{c.stage !== "new" && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${stageClass[c.stage] ?? stageClass["new"]}`}>{STAGES[c.stage as Stage] ?? c.stage}</span>}{sysType(c.system) && <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px]">{SYS[sysType(c.system)!]}</span>}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{fmt(c.last_at)}</span>
                  </div>
                  <div dir="ltr" className="text-right text-xs text-muted-foreground">+{c.phone.replace(/^\+/, "")}</div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">{c.last_message}</span>
                    {c.unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-foreground">{c.unread}</span>}
                  </div>
                </div>
              </button>
            </li>
          ))}
          {!isLoading && shown.length === 0 && (
            <li className="p-6 text-center text-sm text-muted-foreground">
              {customers.length === 0 ? "لا توجد محادثات بعد — ستظهر هنا فور تواصل العملاء مع البوت" : "لا توجد نتائج"}
            </li>
          )}
        </ul>
        </>}
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 md:p-6" onClick={() => setOpenId(null)}>
          <div className="flex h-full w-full overflow-hidden bg-background shadow-2xl md:h-[90vh] md:max-w-6xl md:rounded-2xl md:border md:border-border" onClick={(e) => e.stopPropagation()}>
            <main className="flex min-w-0 flex-1 flex-col">
              <Chat pw={pw} c={open} onBack={() => setOpenId(null)} />
            </main>
            {view === "chats" && <Details pw={pw} c={open} orders={orders.filter((o) => o.customer_id === open.id || o.phone.replace(/\D/g, "").endsWith(open.phone.replace(/\D/g, "").slice(-9)))} />}
          </div>
        </div>
      )}
    </div>
  );
}

const orderStatus: Record<string, string> = { pending: "معلقة", confirmed: "مؤكدة", cancelled: "ملغية" };

function Details({ pw, c, orders }: { pw: string; c: Cust; orders: { id: string; status: string; amount: string | null; invoice_no: string | null; method: string | null; created_at: string }[] }) {
  const stage = c.stage as Stage;
  const digits = c.phone.replace(/\D/g, "");
  const parts = (c.system ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const save = useServerFn(saveNote);
  const qc = useQueryClient();
  const [note, setNote] = useState(c.notes ?? "");
  const [saved, setSaved] = useState<"" | "busy" | "ok" | "err">("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { setNote(c.notes ?? ""); setSaved(""); }, [c.id]);
  const t = sysType(c.system);
  return (
    <aside className="hidden w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-muted/40 p-4 xl:flex">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary text-2xl font-bold text-secondary-foreground">{(c.name ?? "#")[0]}</div>
        <div className="font-bold">{c.name || "عميل"}</div>
        <div className="flex items-center gap-1.5">
          <span dir="ltr" className="text-sm text-muted-foreground">+{digits}</span>
          <button onClick={() => { void navigator.clipboard.writeText("+" + digits); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            aria-label="نسخ الرقم" title="نسخ الرقم" className="rounded p-1 hover:bg-muted">
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        {c.city && <div className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{c.city}</div>}
        <div className="flex flex-wrap justify-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageClass[stage] ?? stageClass["new"]}`}>{STAGES[stage] ?? stage}</span>
          {t && <span className="rounded-full border border-border px-2 py-0.5 text-xs">{SYS[t]}</span>}
        </div>
        <div className="mt-1 grid w-full grid-cols-2 gap-2">
          <a href={`tel:+${digits}`} className="flex items-center justify-center gap-1 rounded-lg border border-border py-2 text-xs hover:bg-muted"><Phone className="h-3.5 w-3.5" />اتصال</a>
          <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1 rounded-lg bg-primary py-2 text-xs text-primary-foreground"><MessageCircle className="h-3.5 w-3.5" />واتساب</a>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><StickyNote className="h-4 w-4 text-primary" />ملاحظات داخلية</h3>
        <textarea value={note} onChange={(e) => { setNote(e.target.value); setSaved(""); }} rows={3} placeholder="خاصة بفريق العمل — لا تُرسل للعميل"
          className="w-full resize-y rounded-lg border border-input bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{saved === "ok" ? "تم الحفظ ✓" : saved === "err" ? "تعذّر الحفظ" : ""}</span>
          <button disabled={saved === "busy" || note === (c.notes ?? "")}
            onClick={async () => { setSaved("busy"); try { await save({ data: { pw, id: c.id, notes: note } }); setSaved("ok"); void qc.invalidateQueries({ queryKey: ["customers"] }); } catch { setSaved("err"); } }}
            className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50">{saved === "busy" ? "جاري..." : "حفظ"}</button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><Sun className="h-4 w-4 text-primary" />المنظومة المختارة</h3>
        {parts.length ? <ul className="space-y-1.5 text-sm">{parts.map((p) => <li key={p} className="rounded-md bg-muted px-2 py-1.5">{p}</li>)}</ul>
          : <p className="text-xs text-muted-foreground">لم يختر العميل منظومة بعد</p>}
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 text-primary" />الطلبات</h3>
        {orders.length ? <ul className="space-y-2 text-xs">{orders.map((o) => (
          <li key={o.id} className="rounded-md border border-border p-2">
            <div className="flex justify-between font-semibold"><span>{o.invoice_no || "طلب"}</span><span>{orderStatus[o.status] ?? o.status}</span></div>
            <div className="mt-1 text-muted-foreground">{[o.amount, o.method, fmt(o.created_at)].filter(Boolean).join(" · ")}</div>
          </li>))}</ul>
          : <p className="text-xs text-muted-foreground">لا توجد طلبات لهذا العميل</p>}
      </div>
      <div className="text-center text-[11px] text-muted-foreground">عميل منذ {new Date(c.created_at).toLocaleDateString("ar")}</div>
    </aside>
  );
}

type Cust = Awaited<ReturnType<typeof listCustomers>>[number];

function Chat({ pw, c, onBack }: { pw: string; c: Cust; onBack: () => void }) {
  const get = useServerFn(getMessages);
  const send = useServerFn(sendMessage);
  const togglePause = useServerFn(setBotPaused);
  const [paused, setPaused] = useState(!!(c as { bot_paused?: boolean }).bot_paused);
  useEffect(() => { setPaused(!!(c as { bot_paused?: boolean }).bot_paused); }, [c.id]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const { data: msgs = [], refetch } = useQuery({
    queryKey: ["messages", c.id],
    queryFn: () => get({ data: { pw, id: c.id } }),
    refetchInterval: 8000,
  });
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView(); }, [msgs.length]);
  const stage = c.stage as Stage;
  return (
    <>
      <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-3">
        <button onClick={onBack} aria-label="رجوع" className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-sm hover:bg-muted"><ArrowRight className="h-5 w-5" /><span className="hidden sm:inline">رجوع</span></button>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary font-bold">{(c.name ?? "#")[0]}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{c.name || "عميل"}</div>
          <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span dir="ltr" className="flex items-center gap-1"><Phone className="h-3 w-3" />+{c.phone.replace(/^\+/, "")}</span>
            {c.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{c.city}</span>}
          </div>
        </div>
        <button
          onClick={async () => { const v = !paused; setPaused(v); try { await togglePause({ data: { pw, id: c.id, paused: v } }); } catch { setPaused(!v); } }}
          className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium ${paused ? "border-destructive bg-destructive text-destructive-foreground" : "border-border hover:bg-muted"}`}
        ><Bot className="h-4 w-4" />{paused ? "تشغيل البوت" : "إيقاف البوت"}</button>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stageClass[stage] ?? stageClass["new"]}`}>{STAGES[stage] ?? stage}</span>
      </header>
      {paused && <div className="bg-destructive px-3 py-1.5 text-center text-xs text-destructive-foreground">البوت متوقف لهذا العميل — أنت تتحدث معه مباشرة</div>}
      {c.system && <div className="flex items-center gap-2 bg-secondary px-3 py-2 text-xs text-secondary-foreground"><Sun className="h-4 w-4" />{c.system}</div>}
      <div className="flex-1 space-y-2 overflow-y-auto bg-chat-bg bg-cover bg-center bg-no-repeat p-3 bg-blend-overlay dark:bg-blend-multiply"
        style={{ backgroundImage: `url(${chatBg.url})` }}>
        {msgs.map((m, i) => (
          <div key={m.id}>
          {(i === 0 || new Date(msgs[i - 1]!.created_at).toDateString() !== new Date(m.created_at).toDateString()) && (
            <div className="my-2 flex justify-center"><span className="rounded-full bg-card px-3 py-0.5 text-[11px] text-muted-foreground shadow-sm">{dayLabel(m.created_at)}</span></div>
          )}
          <div className={`flex ${m.direction === "customer" ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[80%] xl:max-w-[65%] whitespace-pre-wrap break-words px-3 py-2 text-sm shadow-sm ${m.direction === "customer" ? "rounded-2xl rounded-tr-sm bg-bubble-in" : m.direction === "agent" ? "rounded-2xl rounded-tl-sm bg-bubble-agent" : "rounded-2xl rounded-tl-sm bg-bubble-out"}`}>
              {m.kind === "pdf" ? <span className="flex items-center gap-2 font-medium"><FileText className="h-5 w-5 text-destructive" />{m.text}</span>
                : m.kind === "button" ? <span className="rounded border border-primary/40 px-2 py-0.5 text-primary">🔘 {m.text}</span>
                : m.text}
              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                {m.direction === "bot" && <><Bot className="h-3 w-3" />البوت ·</>}
                {m.direction === "agent" && <><User className="h-3 w-3" />الموظف ·</>}
                <span>{fmt(m.created_at)}</span>
              </div>
            </div>
          </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {(() => {
        const lastIn = [...msgs].reverse().find((m) => m.direction === "customer")?.created_at ?? c.last_customer_at;
        const left = lastIn ? 864e5 - (Date.now() - new Date(lastIn).getTime()) : -1;
        return left > 0
          ? <div className="flex items-center gap-1.5 border-t border-border bg-st-buy px-3 py-1 text-[11px] text-st-buy-fg"><Clock className="h-3 w-3" />متاح للإرسال — متبقي {Math.floor(left / 36e5)} ساعة و{Math.floor((left % 36e5) / 6e4)} دقيقة</div>
          : <div className="flex items-center gap-1.5 border-t border-border bg-st-human px-3 py-1 text-[11px] text-st-human-fg"><Clock className="h-3 w-3" />انتهت مهلة 24 ساعة — الرسالة لن تصل حتى يراسلك العميل أولاً</div>;
      })()}
      <form
        className="flex items-end gap-2 border-t border-border bg-card p-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const t = text.trim(); if (!t || sending) return;
          setSending(true); setErr("");
          try { await send({ data: { pw, id: c.id, text: t } }); setText(""); await refetch(); }
          catch (x) { setErr(x instanceof Error ? x.message : "تعذّر الإرسال"); }
          finally { setSending(false); }
        }}
      >
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="اكتب رسالة للعميل..."
          className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <button disabled={sending || !text.trim()} aria-label="إرسال" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50">
          <Send className="h-4 w-4 -scale-x-100" />
        </button>
      </form>
      {err && <p className="px-3 pb-2 text-xs text-destructive">{err}</p>}
    </>
  );
}

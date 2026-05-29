"use client";

import { useEffect, useId, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code,
  CreditCard,
  DollarSign,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Globe,
  History,
  Home,
  Image as ImageIcon,
  Layers,
  LifeBuoy,
  Lock,
  Mail,
  Moon,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  ShoppingBag,
  Sparkles,
  Star,
  Sun,
  Ticket,
  TrendingUp,
  Trash2,
  Truck,
  Users,
  Wand2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

/* Icon registry — string keys used across the admin map to Lucide icons. */
export const Ic: Record<string, LucideIcon> = {
  Home,
  Buildings: Building2,
  Layers,
  Card: CreditCard,
  Chart: BarChart3,
  Help: LifeBuoy,
  Settings,
  History,
  Search,
  Bell,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Sun,
  Moon,
  X,
  Check,
  Eye,
  Edit: Pencil,
  Trash: Trash2,
  Dots: MoreVertical,
  Filter,
  Download,
  External: ExternalLink,
  Globe,
  Users,
  DollarSign,
  Zap,
  Sparkles,
  Wand: Wand2,
  Lock,
  Image: ImageIcon,
  Send,
  Mail,
  Refresh: RefreshCw,
  AlertCircle,
  CheckCircle: CheckCircle2,
  Truck,
  Ticket,
  ShoppingBag,
  TrendUp: TrendingUp,
  Activity,
  Star,
  Calendar,
  Shield,
  Code,
};

/* ---------- formatting ---------- */
export function formatMoney(dollars: number): string {
  if (dollars >= 1e6) return "$" + (dollars / 1e6).toFixed(2) + "M";
  if (dollars >= 1e3) return "$" + (dollars / 1e3).toFixed(1) + "k";
  return "$" + Math.round(dollars).toLocaleString();
}
export function formatMoneyCents(cents: number): string {
  return formatMoney(cents / 100);
}
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/* ---------- tenant avatar ---------- */
const TENANT_COLORS: [string, string][] = [
  ["#2f62f5", "#1b3fa8"],
  ["#16a34a", "#0e7a36"],
  ["#d97706", "#9a5709"],
  ["#7c3aed", "#5b21b6"],
  ["#dc2626", "#991b1b"],
  ["#0891b2", "#155e75"],
  ["#db2777", "#9d174d"],
  ["#65a30d", "#3f6212"],
];
export function tenantColor(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return TENANT_COLORS[h % TENANT_COLORS.length];
}
export function tenantInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
export function TenantAvatar({ name, logoUrl, size = 32 }: { name: string; logoUrl?: string; size?: number }) {
  const [c1, c2] = tenantColor(name);
  if (logoUrl) {
    return (
      <div
        className="tenant-avatar"
        style={{
          width: size,
          height: size,
          borderRadius: size >= 40 ? 10 : 8,
          overflow: "hidden",
          background: "#f1f5f9",
          flexShrink: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={name}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          onError={(e) => {
            const wrapper = (e.target as HTMLImageElement).parentElement;
            if (wrapper) wrapper.setAttribute("data-fallback", "1");
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    );
  }
  return (
    <div
      className="tenant-avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
        fontSize: size >= 40 ? 14 : 11,
        borderRadius: size >= 40 ? 10 : 8,
      }}
    >
      {tenantInitials(name)}
    </div>
  );
}

/* ---------- sparkline ---------- */
export function Sparkline({
  data,
  color = "var(--accent)",
  width = 60,
  height = 28,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  // Stable across SSR + hydration (Math.random() would mismatch).
  const gid = "spg" + useId().replace(/[^a-zA-Z0-9]/g, "");
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1 || 1);
  const pts = data.map((v, i) => `${i * step},${height - 4 - ((v - min) / range) * (height - 8)}`).join(" ");
  const areaPts = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#${gid})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- animated counter ---------- */
function useCounter(target: number, duration = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start: number | undefined;
    const step = (t: number) => {
      if (start === undefined) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

export function CounterValue({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  const v = useCounter(value);
  const formatted = decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString();
  return (
    <>
      {prefix}
      {formatted}
      {suffix}
    </>
  );
}

/* ---------- KPI card ---------- */
export function KPI({
  label,
  value,
  delta,
  deltaDir = "up",
  icon,
  spark,
  sparkColor,
}: {
  label: string;
  value: React.ReactNode;
  delta?: string;
  deltaDir?: "up" | "down" | "flat";
  icon?: string;
  spark?: number[];
  sparkColor?: string;
}) {
  const IconCmp = icon ? Ic[icon] : undefined;
  const ArrowI = deltaDir === "up" ? ArrowUp : deltaDir === "down" ? ArrowDown : ArrowRight;
  return (
    <div className="kpi">
      <div className="kpi-label">
        {IconCmp && <IconCmp />}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      {delta !== undefined && (
        <div className={"kpi-delta " + deltaDir}>
          <ArrowI />
          {delta}
        </div>
      )}
      {spark && <Sparkline data={spark} color={sparkColor || "var(--accent)"} />}
    </div>
  );
}

/* ---------- status badge ---------- */
const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  active: { cls: "badge-success", label: "Active" },
  trial: { cls: "badge-accent", label: "Trial" },
  suspended: { cls: "badge-warn", label: "Suspended" },
  past_due: { cls: "badge-danger", label: "Past due" },
  paid: { cls: "badge-success", label: "Paid" },
  fulfilled: { cls: "badge-success", label: "Fulfilled" },
  pending: { cls: "badge-neutral", label: "Pending" },
  refunded: { cls: "badge-warn", label: "Refunded" },
  canceled: { cls: "badge-neutral", label: "Canceled" },
};
export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_MAP[status] || STATUS_MAP.pending;
  return (
    <span className={"badge " + m.cls}>
      <span className="bdot" />
      {m.label}
    </span>
  );
}

/* ---------- toggle (controlled, display) ---------- */
export function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={"switch " + (on ? "on " : "") + (disabled ? "disabled" : "")}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange?.(!on);
      }}
      role="switch"
      aria-checked={on}
    />
  );
}

/* ---------- bold-markdown renderer for feed text ---------- */
export function FeedText({ text }: { text: string }) {
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

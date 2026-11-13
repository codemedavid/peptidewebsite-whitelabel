// Three phones drawn in HTML (not screenshots) so every store's /app page shows
// ITS OWN shop: the store's logo, colours and real product photos, plus order
// tracking and either the chat (stores with the app community) or the cart
// (shopping-only stores). The tab bar matches the customer app's real tabs.
// Decorative: the real copy lives in the page around it, so the whole group is
// hidden from assistive tech.

import type { ReactNode } from "react";
import {
  Bell,
  Check,
  CircleUserRound,
  House,
  MessageCircle,
  Package,
  Search,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";

import { imageUrl } from "@/lib/media/image-url";
import type { PreviewProduct } from "@/lib/mobile/app-download";

type Props = {
  storeName: string;
  logoUrl: string | null;
  products: PreviewProduct[];
  /** The store runs the app community: show the chat screen and a Chats tab. */
  hasCommunity: boolean;
};

type ScreenProps = { storeName: string; logoUrl: string | null; hasCommunity: boolean };

const PLACEHOLDER_TILES = 4;
const CART_LINES = 2;

export function PhoneMockups({ storeName, logoUrl, products, hasCommunity }: Props) {
  const screen = { storeName, logoUrl, hasCommunity };
  return (
    <div className="ga-phones" aria-hidden>
      <Phone variant="left">
        <TrackingScreen {...screen} />
      </Phone>
      <Phone variant="right">
        {hasCommunity ? <ChatScreen {...screen} /> : <CartScreen {...screen} products={products} />}
      </Phone>
      <Phone variant="center">
        <ShopScreen {...screen} products={products} />
      </Phone>
    </div>
  );
}

function Phone({ variant, children }: { variant: "left" | "center" | "right"; children: ReactNode }) {
  return (
    <div className={`ga-phone ga-phone--${variant}`}>
      <div className="ga-screen">
        <span className="ga-island" />
        {children}
      </div>
    </div>
  );
}

function StoreMark({ storeName, logoUrl }: Pick<ScreenProps, "storeName" | "logoUrl">) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl(logoUrl, { width: 96 })} alt="" width={32} height={32} loading="lazy" />;
  }
  return <span className="ga-monogram">{storeName.trim().charAt(0).toUpperCase()}</span>;
}

function ScreenTop({ storeName, logoUrl, trailing }: Pick<ScreenProps, "storeName" | "logoUrl"> & { trailing?: ReactNode }) {
  return (
    <div className="ga-screen__top">
      <StoreMark storeName={storeName} logoUrl={logoUrl} />
      <span className="min-w-0 flex-1 truncate">{storeName}</span>
      {trailing}
    </div>
  );
}

function ProductPhoto({ product, width }: { product: PreviewProduct | null; width: number }) {
  if (!product) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={imageUrl(product.image, { width })} alt="" loading="lazy" />;
}

function ShopScreen({ storeName, logoUrl, hasCommunity, products }: ScreenProps & { products: PreviewProduct[] }) {
  const tiles: (PreviewProduct | null)[] =
    products.length > 0 ? products : Array.from({ length: PLACEHOLDER_TILES }, () => null);
  return (
    <>
      <ScreenTop storeName={storeName} logoUrl={logoUrl} trailing={<ShoppingBag className="h-[1.3em] w-[1.3em]" />} />
      <div className="ga-screen__body">
        <div className="ga-search flex items-center gap-[0.4em]">
          <Search className="h-[1.1em] w-[1.1em] shrink-0" />
          <span className="truncate">Search {storeName}</span>
        </div>
        <div className="ga-chips">
          <span>All</span>
          <span>New</span>
          <span>Best sellers</span>
        </div>
        <div className="ga-grid">
          {tiles.map((product, index) => (
            <div className="ga-tile" key={product ? `${product.name}-${index}` : `placeholder-${index}`}>
              <div className="ga-tile__img">
                <ProductPhoto product={product} width={240} />
              </div>
              <span className="ga-tile__name">{product ? product.name : " "}</span>
              <span className="ga-tile__add">+ Add</span>
            </div>
          ))}
        </div>
      </div>
      <TabBar active="shop" hasCommunity={hasCommunity} />
    </>
  );
}

type StepState = "done" | "now" | "next";

const TRACKING_STEPS: { label: string; state: StepState }[] = [
  { label: "Order placed", state: "done" },
  { label: "Payment confirmed", state: "done" },
  { label: "Shipped", state: "now" },
  { label: "Delivered", state: "next" },
];

const DOT_CLASS: Record<StepState, string> = { done: "ga-dot is-done", now: "ga-dot is-now", next: "ga-dot" };

function TrackingScreen({ storeName, logoUrl, hasCommunity }: ScreenProps) {
  return (
    <>
      <ScreenTop storeName={storeName} logoUrl={logoUrl} trailing={<Bell className="h-[1.3em] w-[1.3em]" />} />
      <div className="ga-screen__body">
        <strong className="text-[1.25em]">Your order</strong>
        <div className="ga-card flex flex-col gap-[0.4em]">
          <div className="flex items-center justify-between gap-[0.4em]">
            <strong>Order #1042</strong>
            <span className="ga-status">Shipped</span>
          </div>
          <span className="ga-muted">3 items · on the way</span>
        </div>
        <ul className="ga-timeline">
          {TRACKING_STEPS.map((step) => (
            <li key={step.label}>
              <span className={DOT_CLASS[step.state]}>{step.state === "done" ? <Check strokeWidth={3} /> : null}</span>
              <span className={step.state === "next" ? "ga-muted" : "font-semibold"}>{step.label}</span>
            </li>
          ))}
        </ul>
        <div className="ga-card flex items-center gap-[0.5em]">
          <Package className="h-[1.4em] w-[1.4em] shrink-0" />
          <span>
            <strong className="block">Tracking number ready</strong>
            <span className="ga-muted">Follow your courier</span>
          </span>
        </div>
      </div>
      <TabBar active="orders" hasCommunity={hasCommunity} />
    </>
  );
}

function CartScreen({ storeName, logoUrl, hasCommunity, products }: ScreenProps & { products: PreviewProduct[] }) {
  const lines: (PreviewProduct | null)[] = Array.from({ length: CART_LINES }, (_, i) => products[i] ?? null);
  return (
    <>
      <ScreenTop storeName={storeName} logoUrl={logoUrl} />
      <div className="ga-screen__body">
        <strong className="text-[1.25em]">Your cart</strong>
        {lines.map((product, index) => (
          <div className="ga-card flex items-center gap-[0.6em]" key={product ? `${product.name}-${index}` : `line-${index}`}>
            <span className="ga-tile__img w-[2.8em] shrink-0">
              <ProductPhoto product={product} width={120} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate">{product ? product.name : " "}</strong>
              <span className="ga-muted">Qty {index + 1}</span>
            </span>
          </div>
        ))}
        <div className="ga-card flex flex-col gap-[0.35em]">
          <span className="flex justify-between">
            <span className="ga-muted">Delivery</span>
            <span>Choose courier</span>
          </span>
          <span className="flex justify-between">
            <span className="ga-muted">Payment</span>
            <span>Upload proof</span>
          </span>
        </div>
        <span className="ga-checkout">Place order</span>
      </div>
      <TabBar active="shop" hasCommunity={hasCommunity} />
    </>
  );
}

function ChatScreen({ storeName, logoUrl, hasCommunity }: ScreenProps) {
  return (
    <>
      <ScreenTop storeName={storeName} logoUrl={logoUrl} />
      <div className="ga-screen__body">
        <span className="ga-muted self-center text-[0.85em]">Today</span>
        <span className="ga-bubble ga-bubble--store">Hi! Your order is packed and on its way 📦</span>
        <span className="ga-bubble ga-bubble--me">Yay, thank you! 🙏</span>
        <span className="ga-bubble ga-bubble--store">
          Heads up! New stock drops this Friday. You&apos;ll get a ping here first.
        </span>
        <span className="ga-bubble ga-bubble--me">Can&apos;t wait 💕</span>
      </div>
      <TabBar active="chats" hasCommunity={hasCommunity} />
    </>
  );
}

type TabKey = "shop" | "orders" | "chats" | "me";

function TabBar({ active, hasCommunity }: { active: TabKey; hasCommunity: boolean }) {
  const tabs: { key: TabKey; label: string; Icon: LucideIcon }[] = [
    { key: "shop", label: "Shop", Icon: House },
    { key: "orders", label: "Orders", Icon: Package },
    hasCommunity
      ? { key: "chats", label: "Chats", Icon: MessageCircle }
      : { key: "me", label: "Me", Icon: CircleUserRound },
  ];
  return (
    <div className="ga-tabbar">
      {tabs.map(({ key, label, Icon }) => (
        <span key={key} className={key === active ? "is-on" : undefined}>
          <Icon />
          {label}
        </span>
      ))}
    </div>
  );
}

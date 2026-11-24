import { getStore } from "@netlify/blobs"
import type { Config, Context } from "@netlify/functions"

// Items live in one JSON blob ("items"); each order is its own blob ("orders/<id>"),
// so two devices checking out at once never overwrite each other.
const store = () => getStore({ name: "promo-register", consistency: "strong" })

const SAMPLE_ITEMS = [
  { id: "bag", name: "Standard promo bag", kind: "bag", stock: 250, cost: 0 },
  { id: "hat", name: "Cap", kind: "addon", stock: 100, cost: 0 },
  { id: "tumbler", name: "Tumbler", kind: "addon", stock: 75, cost: 0 },
  { id: "shirt", name: "T-shirt", kind: "addon", stock: 120, cost: 0 },
  { id: "jacket", name: "Jacket", kind: "addon", stock: 30, cost: 0 },
  { id: "notebook", name: "Notebook", kind: "addon", stock: 150, cost: 0 },
]

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const str = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max)

function cleanItem(i: any) {
  return {
    id: str(i?.id, 40).replace(/[^\w-]/g, "") || Math.random().toString(36).slice(2, 9),
    name: str(i?.name) || "Item",
    kind: i?.kind === "bag" ? "bag" : "addon",
    stock: Math.max(0, Math.round(num(i?.stock))),
    cost: Math.max(0, num(i?.cost)),
  }
}

async function readItems() {
  const items = await store().get("items", { type: "json" })
  return Array.isArray(items) ? items : SAMPLE_ITEMS
}

async function readOrders() {
  const s = store()
  const { blobs } = await s.list({ prefix: "orders/" })
  const all = await Promise.all(
    blobs.map(async (b) => {
      const o = await s.get(b.key, { type: "json" })
      return o ? { ...o, id: b.key.slice("orders/".length) } : null
    }),
  )
  return all.filter(Boolean)
}

export default async (req: Request, context: Context) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, "")
  try {
    if (req.method === "GET" && route === "state") {
      const [items, orders] = await Promise.all([readItems(), readOrders()])
      return Response.json({ items, orders }, { headers: { "cache-control": "no-store" } })
    }

    if (req.method === "PUT" && route === "items") {
      const body = await req.json()
      if (!Array.isArray(body?.items) || body.items.length > 200) return new Response("Bad items", { status: 400 })
      const items = body.items.map(cleanItem)
      await store().setJSON("items", items)
      return Response.json({ items })
    }

    if (req.method === "POST" && route === "orders") {
      const body = await req.json()
      const dept = str(body?.dept, 40)
      const lines = Array.isArray(body?.lines) ? body.lines.slice(0, 100) : []
      if (!dept || !lines.length) return new Response("Department and items are required", { status: 400 })
      const order = {
        ts: Date.now(),
        dept,
        note: str(body?.note, 200),
        lines: lines
          .map((l: any) => ({
            id: str(l?.id, 40),
            name: str(l?.name),
            kind: l?.kind === "bag" ? "bag" : "addon",
            qty: Math.max(0, Math.round(num(l?.qty))),
            cost: Math.max(0, num(l?.cost)),
          }))
          .filter((l: any) => l.id && l.qty > 0),
      }
      if (!order.lines.length) return new Response("No items", { status: 400 })
      const id = `${order.ts}-${Math.random().toString(36).slice(2, 8)}`
      await store().setJSON(`orders/${id}`, order, { onlyIfNew: true })
      return Response.json({ id, ...order }, { status: 201 })
    }

    const del = route.match(/^orders\/([\w-]+)$/)
    if (req.method === "DELETE" && del) {
      await store().delete(`orders/${del[1]}`)
      return new Response(null, { status: 204 })
    }

    return new Response("Not found", { status: 404 })
  } catch (e) {
    console.error(e)
    return new Response("Server error", { status: 500 })
  }
}

export const config: Config = {
  path: ["/api/state", "/api/items", "/api/orders", "/api/orders/*"],
}

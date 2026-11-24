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

const SAMPLE_DEPTS = [
  { id: "south-ana", name: "South - ANA", code: "" },
  { id: "north-ana", name: "North - ANA", code: "" },
  { id: "east-ana", name: "East - ANA", code: "" },
  { id: "west-ana", name: "West - ANA", code: "" },
  { id: "la", name: "LA", code: "" },
  { id: "eu", name: "EU", code: "" },
  { id: "corp", name: "CORP", code: "" },
  { id: "jan", name: "JAN", code: "" },
]

function cleanDept(d: any) {
  return {
    id: str(d?.id, 40).replace(/[^\w-]/g, "") || Math.random().toString(36).slice(2, 9),
    name: str(d?.name, 60) || "Department",
    code: str(d?.code, 40),
  }
}

async function readDepts() {
  const depts = await store().get("departments", { type: "json" })
  return Array.isArray(depts) ? depts : SAMPLE_DEPTS
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

function pinOk(req: Request) {
  const pin = Netlify.env.get("BOOTH_PIN")
  if (!pin) return false // no PIN set: lock everything rather than leave it open
  const given = req.headers.get("x-booth-pin") ?? ""
  if (given.length !== pin.length) return false
  let diff = 0
  for (let i = 0; i < pin.length; i++) diff |= pin.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

export default async (req: Request, context: Context) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, "")
  if (!pinOk(req)) return new Response("PIN required", { status: 401 })
  try {
    if (req.method === "GET" && route === "state") {
      const [items, departments, orders] = await Promise.all([readItems(), readDepts(), readOrders()])
      return Response.json({ items, departments, orders }, { headers: { "cache-control": "no-store" } })
    }

    if (req.method === "PUT" && route === "items") {
      const body = await req.json()
      if (!Array.isArray(body?.items) || body.items.length > 200) return new Response("Bad items", { status: 400 })
      const items = body.items.map(cleanItem)
      await store().setJSON("items", items)
      return Response.json({ items })
    }

    if (req.method === "PUT" && route === "departments") {
      const body = await req.json()
      if (!Array.isArray(body?.departments) || body.departments.length > 300) return new Response("Bad departments", { status: 400 })
      const departments = body.departments.map(cleanDept)
      await store().setJSON("departments", departments)
      return Response.json({ departments })
    }

    if (req.method === "POST" && route === "orders") {
      const body = await req.json()
      const dept = str(body?.dept, 40)
      const lines = Array.isArray(body?.lines) ? body.lines.slice(0, 100) : []
      if (!dept || !lines.length) return new Response("Department and items are required", { status: 400 })
      const order = {
        ts: Date.now(),
        dept,
        deptCode: str(body?.deptCode, 40),
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
  path: ["/api/state", "/api/items", "/api/departments", "/api/orders", "/api/orders/*"],
  // Slows down PIN guessing; leaves room for several booth devices polling on one network.
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ["ip", "domain"] },
}

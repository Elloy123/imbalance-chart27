"""
HotelSys — Backend Flask REST API
Serves as the API layer for the hotel management system.
The frontend (hotel/index.html) works standalone via localStorage;
this backend provides a persistent, server-side data store alternative.

Usage:
    pip install -r requirements.txt
    python app.py

Endpoints:
    GET    /api/rooms          — list all rooms
    POST   /api/rooms          — create room
    PUT    /api/rooms/<id>     — update room
    DELETE /api/rooms/<id>     — delete room

    GET    /api/guests         — list active guests
    POST   /api/guests/checkin — check in a guest
    POST   /api/guests/<id>/checkout — check out a guest

    GET    /api/products       — list convenience products
    POST   /api/products       — add product
    PUT    /api/products/<id>  — update product (stock, price…)
    DELETE /api/products/<id>  — remove product

    GET    /api/orders         — list convenience orders
    POST   /api/orders         — create order (deducts stock)

    GET    /api/history        — checkout history / reports
    GET    /api/reports        — aggregated report stats
"""

import json
import os
import uuid
from datetime import date, datetime, timezone
from math import ceil

from flask import Flask, abort, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Simple JSON file-based persistence (drop-in for a real DB)
# ---------------------------------------------------------------------------
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)

FILES = {
    "rooms": os.path.join(DATA_DIR, "rooms.json"),
    "guests": os.path.join(DATA_DIR, "guests.json"),
    "products": os.path.join(DATA_DIR, "products.json"),
    "orders": os.path.join(DATA_DIR, "orders.json"),
    "history": os.path.join(DATA_DIR, "history.json"),
}

DEFAULTS = {
    "rooms": [
        {"id": "1",  "number": "101", "floor": 1, "type": "solteiro", "status": "disponivel", "price": 89.90,  "amenities": ["Wi-Fi", "TV", "Ventilador"],                              "currentGuest": None},
        {"id": "2",  "number": "102", "floor": 1, "type": "solteiro", "status": "disponivel", "price": 89.90,  "amenities": ["Wi-Fi", "TV", "Ventilador"],                              "currentGuest": None},
        {"id": "3",  "number": "103", "floor": 1, "type": "casal",    "status": "disponivel", "price": 149.90, "amenities": ["Wi-Fi", "TV", "Ar-condicionado", "Frigobar"],             "currentGuest": None},
        {"id": "4",  "number": "104", "floor": 1, "type": "casal",    "status": "disponivel", "price": 149.90, "amenities": ["Wi-Fi", "TV", "Ar-condicionado", "Frigobar"],             "currentGuest": None},
        {"id": "5",  "number": "105", "floor": 1, "type": "triplo",   "status": "disponivel", "price": 199.90, "amenities": ["Wi-Fi", "TV", "Ar-condicionado", "Frigobar", "Banheiro Privativo"], "currentGuest": None},
        {"id": "6",  "number": "201", "floor": 2, "type": "solteiro", "status": "disponivel", "price": 89.90,  "amenities": ["Wi-Fi", "TV", "Ventilador"],                              "currentGuest": None},
        {"id": "7",  "number": "202", "floor": 2, "type": "casal",    "status": "disponivel", "price": 159.90, "amenities": ["Wi-Fi", "TV", "Ar-condicionado", "Frigobar"],             "currentGuest": None},
        {"id": "8",  "number": "203", "floor": 2, "type": "triplo",   "status": "disponivel", "price": 209.90, "amenities": ["Wi-Fi", "TV", "Ar-condicionado", "Frigobar", "Banheiro Privativo"], "currentGuest": None},
        {"id": "9",  "number": "204", "floor": 2, "type": "casal",    "status": "manutencao", "price": 159.90, "amenities": ["Wi-Fi", "TV", "Ar-condicionado"],                         "currentGuest": None},
        {"id": "10", "number": "301", "floor": 3, "type": "solteiro", "status": "disponivel", "price": 99.90,  "amenities": ["Wi-Fi", "TV", "Ar-condicionado"],                         "currentGuest": None},
        {"id": "11", "number": "302", "floor": 3, "type": "casal",    "status": "disponivel", "price": 169.90, "amenities": ["Wi-Fi", "TV", "Ar-condicionado", "Frigobar", "Banheira"], "currentGuest": None},
        {"id": "12", "number": "303", "floor": 3, "type": "triplo",   "status": "disponivel", "price": 219.90, "amenities": ["Wi-Fi", "TV", "Ar-condicionado", "Frigobar", "Banheira", "Vista Panoramica"], "currentGuest": None},
    ],
    "guests": [],
    "products": [
        # Bebidas
        {"id": "p1",  "name": "Agua Mineral 500ml",   "emoji": "💧", "category": "bebidas",  "price": 3.50,  "stock": 50},
        {"id": "p2",  "name": "Agua com Gas 500ml",   "emoji": "💧", "category": "bebidas",  "price": 4.00,  "stock": 30},
        {"id": "p3",  "name": "Refrigerante Lata",    "emoji": "🥤", "category": "bebidas",  "price": 5.50,  "stock": 40},
        {"id": "p4",  "name": "Suco de Caixinha",     "emoji": "🧃", "category": "bebidas",  "price": 4.50,  "stock": 35},
        {"id": "p5",  "name": "Cerveja Long Neck",    "emoji": "🍺", "category": "bebidas",  "price": 8.00,  "stock": 60},
        {"id": "p6",  "name": "Energetico",           "emoji": "⚡", "category": "bebidas",  "price": 9.00,  "stock": 20},
        {"id": "p7",  "name": "Cafe Soluvel",         "emoji": "☕", "category": "bebidas",  "price": 5.00,  "stock": 25},
        {"id": "p8",  "name": "Achocolatado",         "emoji": "🍫", "category": "bebidas",  "price": 4.50,  "stock": 30},
        # Bolachas & Doces
        {"id": "p9",  "name": "Bolacha Recheada",     "emoji": "🍪", "category": "bolachas", "price": 4.00,  "stock": 40},
        {"id": "p10", "name": "Biscoito Salgado",     "emoji": "🥨", "category": "bolachas", "price": 3.50,  "stock": 35},
        {"id": "p11", "name": "Wafer de Chocolate",   "emoji": "🍫", "category": "bolachas", "price": 4.50,  "stock": 30},
        {"id": "p12", "name": "Balas e Gomas",        "emoji": "🍬", "category": "bolachas", "price": 3.00,  "stock": 50},
        {"id": "p13", "name": "Barra de Cereal",      "emoji": "🌾", "category": "bolachas", "price": 5.00,  "stock": 25},
        {"id": "p14", "name": "Chocolate ao Leite",   "emoji": "🍫", "category": "bolachas", "price": 7.00,  "stock": 20},
        # Salgados & Snacks
        {"id": "p15", "name": "Batata Chips",         "emoji": "🥔", "category": "salgados", "price": 5.50,  "stock": 30},
        {"id": "p16", "name": "Amendoim Torrado",     "emoji": "🥜", "category": "salgados", "price": 4.00,  "stock": 25},
        {"id": "p17", "name": "Salgadinho de Milho",  "emoji": "🌽", "category": "salgados", "price": 5.00,  "stock": 30},
        {"id": "p18", "name": "Pipoca Microondas",    "emoji": "🍿", "category": "salgados", "price": 6.00,  "stock": 20},
        # Higiene
        {"id": "p19", "name": "Sabonete",             "emoji": "🧼", "category": "higiene",  "price": 4.50,  "stock": 30},
        {"id": "p20", "name": "Shampoo Individual",   "emoji": "🧴", "category": "higiene",  "price": 6.00,  "stock": 25},
        {"id": "p21", "name": "Escova + Pasta Dental","emoji": "🦷", "category": "higiene",  "price": 8.00,  "stock": 20},
        {"id": "p22", "name": "Protetor Solar 50+",   "emoji": "☀️", "category": "higiene",  "price": 15.00, "stock": 15},
        # Outros
        {"id": "p23", "name": "Pilhas AA (2un)",      "emoji": "🔋", "category": "outros",   "price": 7.00,  "stock": 20},
        {"id": "p24", "name": "Adaptador de Tomada",  "emoji": "🔌", "category": "outros",   "price": 10.00, "stock": 10},
    ],
    "orders": [],
    "history": [],
}


def _read(key):
    path = FILES[key]
    if not os.path.exists(path):
        data = DEFAULTS[key]
        _write(key, data)
        return data
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _write(key, data):
    with open(FILES[key], "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def _new_id():
    return str(uuid.uuid4())[:8]


def _diff_days(a: str, b: str) -> int:
    da = date.fromisoformat(a)
    db = date.fromisoformat(b)
    return max(1, (db - da).days)


# ---------------------------------------------------------------------------
# Rooms
# ---------------------------------------------------------------------------

@app.get("/api/rooms")
def list_rooms():
    return jsonify(_read("rooms"))


@app.post("/api/rooms")
def create_room():
    data = request.get_json(force=True)
    rooms = _read("rooms")
    if any(r["number"] == data.get("number") for r in rooms):
        abort(409, "Número de quarto já existe")
    room = {
        "id": _new_id(),
        "number": data["number"],
        "floor": int(data.get("floor", 1)),
        "type": data["type"],          # solteiro | casal | triplo
        "status": data.get("status", "disponivel"),
        "price": float(data["price"]),
        "amenities": data.get("amenities", []),
        "currentGuest": None,
    }
    rooms.append(room)
    _write("rooms", rooms)
    return jsonify(room), 201


@app.put("/api/rooms/<room_id>")
def update_room(room_id):
    rooms = _read("rooms")
    room = next((r for r in rooms if r["id"] == room_id), None)
    if not room:
        abort(404, "Quarto não encontrado")
    data = request.get_json(force=True)
    for field in ("floor", "type", "status", "price", "amenities"):
        if field in data:
            room[field] = data[field]
    _write("rooms", rooms)
    return jsonify(room)


@app.delete("/api/rooms/<room_id>")
def delete_room(room_id):
    rooms = _read("rooms")
    room = next((r for r in rooms if r["id"] == room_id), None)
    if not room:
        abort(404)
    if room["status"] == "ocupado":
        abort(409, "Não é possível remover quarto ocupado")
    rooms = [r for r in rooms if r["id"] != room_id]
    _write("rooms", rooms)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Guests / Check-in / Check-out
# ---------------------------------------------------------------------------

@app.get("/api/guests")
def list_guests():
    return jsonify(_read("guests"))


@app.post("/api/guests/checkin")
def checkin():
    data = request.get_json(force=True)
    rooms = _read("rooms")
    room = next((r for r in rooms if r["id"] == str(data.get("roomId"))), None)
    if not room:
        abort(404, "Quarto não encontrado")
    if room["status"] != "disponivel":
        abort(409, "Quarto não está disponível")
    if data.get("checkoutDate") <= data.get("checkinDate"):
        abort(400, "Data de checkout deve ser após o check-in")

    guests = _read("guests")
    guest = {
        "id": _new_id(),
        "name": data["name"],
        "cpf": data.get("cpf", ""),
        "phone": data.get("phone", ""),
        "email": data.get("email", ""),
        "notes": data.get("notes", ""),
        "roomId": str(data["roomId"]),
        "checkinDate": data["checkinDate"],
        "checkoutDate": data["checkoutDate"],
        "checkinTime": datetime.now(timezone.utc).isoformat(),
    }
    guests.append(guest)
    _write("guests", guests)

    room["status"] = "ocupado"
    room["currentGuest"] = guest["id"]
    _write("rooms", rooms)

    return jsonify(guest), 201


@app.post("/api/guests/<guest_id>/checkout")
def checkout(guest_id):
    guests = _read("guests")
    guest = next((g for g in guests if g["id"] == guest_id), None)
    if not guest:
        abort(404, "Hóspede não encontrado")

    rooms = _read("rooms")
    room = next((r for r in rooms if r["id"] == guest["roomId"]), None)
    orders = _read("orders")

    nights = _diff_days(guest["checkinDate"], guest["checkoutDate"])
    room_cost = nights * (room["price"] if room else 0)
    store_cost = sum(o["total"] for o in orders if o.get("guestId") == guest_id)

    history_entry = {
        "id": _new_id(),
        "guestName": guest["name"],
        "guestCpf": guest.get("cpf", ""),
        "roomNumber": room["number"] if room else "?",
        "roomType": room["type"] if room else "?",
        "checkinDate": guest["checkinDate"],
        "checkoutDate": guest["checkoutDate"],
        "nights": nights,
        "roomTotal": room_cost,
        "storeTotal": store_cost,
        "total": room_cost + store_cost,
        "checkoutTime": datetime.now(timezone.utc).isoformat(),
    }
    history = _read("history")
    history.append(history_entry)
    _write("history", history)

    if room:
        room["status"] = "disponivel"
        room["currentGuest"] = None
        _write("rooms", rooms)

    guests = [g for g in guests if g["id"] != guest_id]
    _write("guests", guests)

    return jsonify(history_entry)


# ---------------------------------------------------------------------------
# Convenience Store — Products
# ---------------------------------------------------------------------------

@app.get("/api/products")
def list_products():
    return jsonify(_read("products"))


@app.post("/api/products")
def create_product():
    data = request.get_json(force=True)
    products = _read("products")
    product = {
        "id": _new_id(),
        "name": data["name"],
        "emoji": data.get("emoji", "📦"),
        "category": data.get("category", "outros"),
        "price": float(data["price"]),
        "stock": int(data.get("stock", 0)),
    }
    products.append(product)
    _write("products", products)
    return jsonify(product), 201


@app.put("/api/products/<product_id>")
def update_product(product_id):
    products = _read("products")
    product = next((p for p in products if p["id"] == product_id), None)
    if not product:
        abort(404)
    data = request.get_json(force=True)
    for field in ("name", "emoji", "category", "price", "stock"):
        if field in data:
            product[field] = data[field]
    _write("products", products)
    return jsonify(product)


@app.delete("/api/products/<product_id>")
def delete_product(product_id):
    products = _read("products")
    products = [p for p in products if p["id"] != product_id]
    _write("products", products)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Convenience Store — Orders
# ---------------------------------------------------------------------------

@app.get("/api/orders")
def list_orders():
    return jsonify(_read("orders"))


@app.post("/api/orders")
def create_order():
    data = request.get_json(force=True)
    guest_id = data.get("guestId")
    items = data.get("items", [])  # [{id, name, price, quantity}]

    guests = _read("guests")
    rooms = _read("rooms")
    products = _read("products")

    guest = next((g for g in guests if g["id"] == guest_id), None)
    if not guest:
        abort(404, "Hóspede não encontrado")
    room = next((r for r in rooms if r["id"] == guest["roomId"]), None)

    # Validate and deduct stock
    for item in items:
        product = next((p for p in products if p["id"] == item["id"]), None)
        if not product:
            abort(404, f"Produto {item['id']} não encontrado")
        if product["stock"] < item["quantity"]:
            abort(409, f"Estoque insuficiente: {product['name']}")

    for item in items:
        product = next((p for p in products if p["id"] == item["id"]), None)
        product["stock"] -= item["quantity"]
    _write("products", products)

    total = sum(i["price"] * i["quantity"] for i in items)
    order = {
        "id": _new_id(),
        "guestId": guest_id,
        "guestName": guest["name"],
        "roomNumber": room["number"] if room else "?",
        "items": items,
        "total": total,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    orders = _read("orders")
    orders.append(order)
    _write("orders", orders)
    return jsonify(order), 201


# ---------------------------------------------------------------------------
# History & Reports
# ---------------------------------------------------------------------------

@app.get("/api/history")
def get_history():
    return jsonify(_read("history"))


@app.get("/api/reports")
def get_reports():
    rooms = _read("rooms")
    guests = _read("guests")
    orders = _read("orders")
    history = _read("history")
    products = _read("products")

    room_revenue = sum(h["roomTotal"] for h in history)
    store_revenue = sum(o["total"] for o in orders)
    avg_stay = (sum(h["nights"] for h in history) / len(history)) if history else 0

    occupancy = {
        t: {
            "total": len([r for r in rooms if r["type"] == t]),
            "occupied": len([r for r in rooms if r["type"] == t and r["status"] == "ocupado"]),
        }
        for t in ("solteiro", "casal", "triplo")
    }

    all_items = [i for o in orders for i in o["items"]]
    prod_index = {p["name"]: p["category"] for p in products}
    cat_sales = {}
    for item in all_items:
        cat = prod_index.get(item["name"], "outros")
        cat_sales[cat] = cat_sales.get(cat, 0) + item["price"] * item["quantity"]

    prod_sales = {}
    for item in all_items:
        prod_sales[item["name"]] = prod_sales.get(item["name"], 0) + item["price"] * item["quantity"]
    top_products = sorted(prod_sales.items(), key=lambda x: x[1], reverse=True)[:6]

    return jsonify({
        "roomRevenue": room_revenue,
        "storeRevenue": store_revenue,
        "totalRevenue": room_revenue + store_revenue,
        "totalGuests": len(history) + len(guests),
        "avgStayNights": round(avg_stay, 1),
        "roomStatus": {
            s: len([r for r in rooms if r["status"] == s])
            for s in ("disponivel", "ocupado", "reservado", "manutencao")
        },
        "occupancyByType": occupancy,
        "categoryRevenue": cat_sales,
        "topProducts": [{"name": n, "revenue": round(v, 2)} for n, v in top_products],
    })


# ---------------------------------------------------------------------------
# Dev server
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    print("HotelSys Backend — http://localhost:5000")
    app.run(debug=debug, port=5000)

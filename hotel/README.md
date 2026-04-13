# HotelSys — Sistema de Hospedaria

Sistema completo de gerenciamento para hotel com hospedaria, incluindo controle de quartos, hóspedes e loja de conveniência.

## Funcionalidades

### 🛏️ Quartos
- **Solteiro** — 1 cama de solteiro
- **Casal** — 1 cama de casal
- **Triplo** — 3 camas
- Status: Disponível, Ocupado, Reservado, Manutenção
- Gerenciamento de comodidades por quarto

### 👥 Hóspedes
- Check-in com dados completos (nome, CPF, telefone, email)
- Cálculo automático de diárias e valor total
- Check-out com fatura detalhada (hospedagem + consumos)
- Destaque visual para checkouts previstos para hoje

### 🛒 Conveniência
- Catálogo de produtos por categoria:
  - 🥤 Bebidas (água, refrigerante, suco, cerveja, energético…)
  - 🍪 Bolachas & Doces (recheada, wafer, chocolate, barra de cereal…)
  - 🥨 Salgados & Snacks (chips, amendoim, pipoca…)
  - 🧴 Higiene (sabonete, shampoo, escova dental, protetor solar…)
  - 📦 Outros (pilhas, adaptador…)
- Carrinho vinculado ao quarto do hóspede
- Controle de estoque automático
- Histórico completo de pedidos

### 📊 Relatórios
- Ocupação por tipo de quarto
- Receita de hospedagem e conveniência
- Vendas por categoria de produto
- Produtos mais vendidos
- Histórico completo de estadias

---

## Como usar

### Frontend (modo standalone — sem backend)
O arquivo `hotel/index.html` é totalmente autossuficiente.  
Basta abri-lo no navegador — os dados são salvos no `localStorage`.

```bash
# Abra diretamente no navegador:
open hotel/index.html
# ou
xdg-open hotel/index.html
```

### Backend Flask (modo servidor)

```bash
cd hotel/backend
pip install -r requirements.txt
python app.py
# API disponível em http://localhost:5000
```

#### Endpoints principais

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/rooms` | Listar quartos |
| POST | `/api/rooms` | Criar quarto |
| PUT | `/api/rooms/<id>` | Atualizar quarto |
| DELETE | `/api/rooms/<id>` | Remover quarto |
| GET | `/api/guests` | Listar hóspedes ativos |
| POST | `/api/guests/checkin` | Fazer check-in |
| POST | `/api/guests/<id>/checkout` | Fazer check-out |
| GET | `/api/products` | Listar produtos da conveniência |
| POST | `/api/products` | Adicionar produto |
| PUT | `/api/products/<id>` | Atualizar produto / estoque |
| DELETE | `/api/products/<id>` | Remover produto |
| GET | `/api/orders` | Listar pedidos da conveniência |
| POST | `/api/orders` | Registrar pedido |
| GET | `/api/history` | Histórico de estadias |
| GET | `/api/reports` | Relatório agregado |

---

## Tipos de Quarto e Preços Padrão

| Tipo | Camas | Preço/Diária (padrão) |
|------|-------|----------------------|
| Solteiro | 1 cama de solteiro | R$ 89,90 |
| Casal | 1 cama de casal | R$ 149,90 |
| Triplo | 3 camas | R$ 199,90 |

> Os preços podem ser personalizados por quarto.

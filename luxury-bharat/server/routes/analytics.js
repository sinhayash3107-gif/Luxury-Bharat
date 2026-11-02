import { GET, bad } from '../lib/http.js';
import { get, all } from '../lib/db.js';
import { requireStaff, requirePerm, hasPerm } from '../lib/auth.js';
import { orderDetail } from './shop.js';

// Revenue rules: cancelled orders never count. "Paid revenue" = payment_status paid. "Pending" = not yet paid and not cancelled.
const IST = "datetime(created_at,'+330 minutes')";
const FMT = { daily: '%Y-%m-%d', weekly: '%Y-W%W', monthly: '%Y-%m', yearly: '%Y' };
const range = (q) => {
  const to = q.to ? new Date(q.to) : new Date(), from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86400_000);
  if (Number.isNaN(+to) || Number.isNaN(+from)) throw bad('Invalid date range.');
  return [from.toISOString(), new Date(to.getTime() + 86400_000 - 1).toISOString()];
};

GET('/api/admin/overview', requireStaff, (ctx) => {
  const money = hasPerm(ctx.user, 'analytics');
  const o = {
    totalOrders: get("SELECT COUNT(*) n FROM orders WHERE status<>'cancelled'").n,
    pendingOrders: get("SELECT COUNT(*) n FROM orders WHERE status='pending'").n,
    totalCustomers: get("SELECT COUNT(*) n FROM users WHERE role='customer'").n,
    totalProducts: get("SELECT COUNT(*) n FROM products WHERE status<>'archived'").n,
    openTickets: get("SELECT COUNT(*) n FROM tickets WHERE status IN ('open','in_progress')").n,
    lowStock: all("SELECT id,name,stock,low_stock_threshold lowStockThreshold FROM products WHERE status='active' AND stock<=low_stock_threshold ORDER BY stock LIMIT 10"),
    recentOrders: all('SELECT * FROM orders ORDER BY id DESC LIMIT 6').map(orderDetail),
    recentCustomers: all("SELECT id,username,email,created_at createdAt FROM users WHERE role='customer' ORDER BY id DESC LIMIT 6"),
  };
  if (money) {
    o.paidRevenue = get("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status<>'cancelled' AND payment_status='paid'").n;
    o.pendingRevenue = get("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status<>'cancelled' AND payment_status<>'paid'").n;
    o.bestSellers = all("SELECT p.id,p.name,p.sold_count soldCount FROM products p WHERE p.sold_count>0 ORDER BY p.sold_count DESC LIMIT 5");
  }
  return o;
});

const an = requirePerm('analytics');
GET('/api/admin/analytics/sales', an, (ctx) => {
  const f = FMT[ctx.query.range] || FMT.daily;
  const [from, to] = range(ctx.query);
  const rows = all(`SELECT strftime('${f}', ${IST}) bucket,
      SUM(status<>'cancelled') orders,
      COALESCE(SUM(CASE WHEN status<>'cancelled' AND payment_status='paid' THEN total END),0) paidRevenue,
      COALESCE(SUM(CASE WHEN status<>'cancelled' AND payment_status<>'paid' THEN total END),0) pendingRevenue,
      SUM(status='cancelled') cancelled
    FROM orders WHERE created_at BETWEEN ? AND ? GROUP BY bucket ORDER BY bucket`, from, to);
  const t = rows.reduce((a, r) => ({ orders: a.orders + r.orders, paid: a.paid + r.paidRevenue, pending: a.pending + r.pendingRevenue }), { orders: 0, paid: 0, pending: 0 });
  return { series: rows, totals: t };
});
GET('/api/admin/analytics/customers', an, (ctx) => {
  const f = FMT[ctx.query.range] || FMT.daily;
  const [from, to] = range(ctx.query);
  return {
    customers: all(`SELECT strftime('${f}', ${IST}) bucket, COUNT(*) count FROM users WHERE role='customer' AND created_at BETWEEN ? AND ? GROUP BY bucket ORDER BY bucket`, from, to),
    orders: all(`SELECT strftime('${f}', ${IST}) bucket, COUNT(*) count FROM orders WHERE status<>'cancelled' AND created_at BETWEEN ? AND ? GROUP BY bucket ORDER BY bucket`, from, to),
    total: get("SELECT COUNT(*) n FROM users WHERE role='customer'").n, verified: get("SELECT COUNT(*) n FROM users WHERE role='customer' AND email_verified=1").n,
  };
});
GET('/api/admin/analytics/products', an, (ctx) => {
  const [from, to] = range(ctx.query);
  const ok = "o.status<>'cancelled' AND o.created_at BETWEEN ? AND ?";
  return {
    best: all(`SELECT oi.name, SUM(oi.qty) units, SUM(oi.qty*oi.unit_price) revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE ${ok} GROUP BY oi.product_id, oi.name ORDER BY units DESC LIMIT 10`, from, to),
    categories: all(`SELECT COALESCE(c.name,'Uncategorised') name, SUM(oi.qty) units, SUM(oi.qty*oi.unit_price) revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN categories c ON c.id=p.category_id WHERE ${ok} GROUP BY c.id ORDER BY revenue DESC`, from, to),
    inventoryTrend: all("SELECT strftime('%Y-%m-%d', datetime(created_at,'+330 minutes')) bucket, SUM(CASE WHEN delta>0 THEN delta ELSE 0 END) added, SUM(CASE WHEN delta<0 THEN -delta ELSE 0 END) removed FROM inventory_movements WHERE created_at BETWEEN ? AND ? GROUP BY bucket ORDER BY bucket", from, to),
    stockValue: get("SELECT COALESCE(SUM(stock*COALESCE(discount_price,price)),0) n FROM products WHERE status='active'").n,
  };
});

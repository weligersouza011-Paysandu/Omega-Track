import { TrendingUp, TrendingDown } from 'lucide-react';

export default function StatCard({
  title,
  value,
  icon: Icon,
  iconBg = 'bg-omega-900',
  iconColor = 'text-white',
  trend,
  trendLabel,
  sub,
}) {
  const trendPositive = trend >= 0;
  return (
    <div className="card p-5 hover:shadow-card-hover transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-omega-500 uppercase tracking-wide truncate">{title}</p>
          <p className="mt-2 text-3xl font-extrabold text-omega-900 tracking-tight tabular-nums">{value}</p>
          {sub && <p className="mt-1 text-sm text-omega-500">{sub}</p>}
          {trend !== undefined && (
            <div className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold ${trendPositive ? 'text-status-verde' : 'text-status-vermelho'}`}>
              {trendPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              <span className="tabular-nums">{Math.abs(trend)}%</span>
              {trendLabel && <span className="text-omega-500 font-normal">&nbsp;{trendLabel}</span>}
            </div>
          )}
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
          {Icon && <Icon size={22} strokeWidth={2.2} />}
        </div>
      </div>
    </div>
  );
}

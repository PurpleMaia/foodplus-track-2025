import React, { useState, useEffect } from 'react';
import { Activity, AlertTriangle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

interface CronHealthData {
  healthy: boolean;
  lastScrapeTime: string | null;
  hoursSinceLastScrape: number;
  lastSuccess: boolean;
  lastBillsScraped: number | null;
  lastError: string | null;
  reason?: string;
}

const CronHealth: React.FC = () => {
  const [health, setHealth] = useState<CronHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cron-health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  if (loading) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-gray-600 text-sm font-medium">Cron Health</h3>
            <p className="mt-2 text-gray-400 text-sm">Loading...</p>
          </div>
          <div className="p-3 rounded-full bg-white shadow-sm">
            <RefreshCw className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-gray-600 text-sm font-medium">Cron Health</h3>
            <p className="mt-2 text-2xl font-bold text-red-700">Error</p>
            <p className="mt-2 text-red-600 text-sm">{error}</p>
          </div>
          <div className="p-3 rounded-full bg-white shadow-sm">
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
        </div>
      </div>
    );
  }

  if (!health) return null;

  const isHealthy = health.healthy;
  const isStale = health.hoursSinceLastScrape > 26;
  const hasFailed = !health.lastSuccess;

  let statusLabel: string;
  let statusColor: string;
  let icon: React.ReactNode;

  if (isHealthy) {
    statusLabel = 'Healthy';
    statusColor = 'bg-green-50 border-green-200';
    icon = <CheckCircle className="w-8 h-8 text-green-500" />;
  } else if (isStale) {
    statusLabel = 'Stale';
    statusColor = 'bg-yellow-50 border-yellow-200';
    icon = <AlertTriangle className="w-8 h-8 text-yellow-600" />;
  } else if (hasFailed) {
    statusLabel = 'Failed';
    statusColor = 'bg-red-50 border-red-200';
    icon = <XCircle className="w-8 h-8 text-red-500" />;
  } else {
    statusLabel = 'Unknown';
    statusColor = 'bg-gray-50 border-gray-200';
    icon = <Activity className="w-8 h-8 text-gray-500" />;
  }

  const hoursAgo = health.hoursSinceLastScrape;
  const timeAgoText = hoursAgo < 1
    ? `${Math.round(hoursAgo * 60)}m ago`
    : `${hoursAgo.toFixed(1)}h ago`;

  return (
    <div className={`${statusColor} border rounded-lg p-6 transition-all duration-200 hover:shadow-md`}>
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-gray-600 text-sm font-medium">Cron Health</h3>
          <div className="mt-2 flex flex-col">
            <p className="text-2xl font-bold text-gray-900">{statusLabel}</p>
            <p className="text-gray-500 text-sm">Last run: {timeAgoText}</p>
          </div>
          <div className="mt-2 text-gray-500 text-sm space-y-0.5">
            <p>Bills scraped: {health.lastBillsScraped ?? 'N/A'}</p>
            {health.lastError && (
              <p className="text-red-600 truncate" title={health.lastError}>
                Error: {health.lastError}
              </p>
            )}
          </div>
        </div>
        <div className="p-3 rounded-full bg-white shadow-sm cursor-pointer" onClick={fetchHealth} title="Refresh">
          {icon}
        </div>
      </div>
    </div>
  );
};

export default CronHealth;

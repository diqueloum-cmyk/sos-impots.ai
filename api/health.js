import { getMaintenanceStatus } from '../lib/db.js';

export default async function handler(req, res) {
  const ok = Boolean(process.env.OPENAI_API_KEY);

  let maintenance = { enabled: false, message: '', bypassPassword: '' };
  try {
    maintenance = await getMaintenanceStatus();
  } catch {
    // Table may not exist yet — default to not in maintenance
  }

  // Vérifier si un bypass est fourni
  const bypassParam = req.query?.bypass || null;
  const bypassValid = maintenance.enabled
    && maintenance.bypassPassword
    && bypassParam === maintenance.bypassPassword;

  res.status(ok ? 200 : 500).json({
    ok,
    hasKey: ok,
    maintenance: maintenance.enabled && !bypassValid,
    maintenanceMessage: maintenance.enabled && !bypassValid ? maintenance.message : null
  });
}

import path from 'path';
import crypto from 'crypto';
import fs from 'fs-extra';

const ROOT = process.cwd();
const ECONOMY_DIR = path.resolve(ROOT, 'data', 'economy');

function parseArgs(argv) {
  const out = {
    out: '',
    baseline: ''
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') out.out = argv[i + 1] || '';
    if (a === '--baseline') out.baseline = argv[i + 1] || '';
  }
  return out;
}

function sha256(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

async function guildSnapshot(filePath) {
  const data = await fs.readJson(filePath);
  const users = Object.values(data.users || {});
  const totalUsers = users.length;
  const totalCoins = users.reduce((acc, u) => acc + Math.floor(Number(u.coins || 0)), 0);
  const totalXp = users.reduce((acc, u) => acc + Math.floor(Number(u.xp || 0)), 0);
  const invalidUsers = users.filter(
    (u) =>
      !u.userId ||
      !Number.isFinite(Number(u.coins)) ||
      !Number.isFinite(Number(u.xp)) ||
      Number(u.coins) < 0 ||
      Number(u.xp) < 0
  ).length;

  return {
    guildId: data.guildId || path.basename(filePath, '.json'),
    file: path.basename(filePath),
    totalUsers,
    totalCoins,
    totalXp,
    invalidUsers,
    hash: sha256(data)
  };
}

async function buildSnapshot() {
  await fs.ensureDir(ECONOMY_DIR);
  const files = (await fs.readdir(ECONOMY_DIR))
    .filter((f) => f.endsWith('.json') && f !== 'panels.json')
    .sort();

  const guilds = [];
  for (const file of files) {
    guilds.push(await guildSnapshot(path.join(ECONOMY_DIR, file)));
  }

  const totals = guilds.reduce(
    (acc, g) => {
      acc.guilds += 1;
      acc.users += g.totalUsers;
      acc.coins += g.totalCoins;
      acc.xp += g.totalXp;
      acc.invalidUsers += g.invalidUsers;
      return acc;
    },
    { guilds: 0, users: 0, coins: 0, xp: 0, invalidUsers: 0 }
  );

  return {
    generatedAt: new Date().toISOString(),
    economyDir: ECONOMY_DIR,
    totals,
    guilds
  };
}

function compareSnapshots(current, baseline) {
  const byGuildCurrent = new Map(current.guilds.map((g) => [g.guildId, g]));
  const byGuildBase = new Map(baseline.guilds.map((g) => [g.guildId, g]));
  const guildIds = [...new Set([...byGuildCurrent.keys(), ...byGuildBase.keys()])].sort();

  const diffs = guildIds.map((guildId) => {
    const cur = byGuildCurrent.get(guildId);
    const base = byGuildBase.get(guildId);
    if (!cur || !base) {
      return { guildId, status: 'added_or_removed' };
    }
    return {
      guildId,
      usersDelta: cur.totalUsers - base.totalUsers,
      coinsDelta: cur.totalCoins - base.totalCoins,
      xpDelta: cur.totalXp - base.totalXp,
      hashChanged: cur.hash !== base.hash
    };
  });

  return {
    totalsDelta: {
      guilds: current.totals.guilds - baseline.totals.guilds,
      users: current.totals.users - baseline.totals.users,
      coins: current.totals.coins - baseline.totals.coins,
      xp: current.totals.xp - baseline.totals.xp,
      invalidUsers: current.totals.invalidUsers - baseline.totals.invalidUsers
    },
    guildDiffs: diffs
  };
}

async function main() {
  const { out, baseline } = parseArgs(process.argv.slice(2));
  const current = await buildSnapshot();

  let report = { current };
  if (baseline) {
    const base = await fs.readJson(path.resolve(ROOT, baseline));
    report = { current, baseline: base, diff: compareSnapshots(current, base) };
  }

  if (out) {
    const outPath = path.resolve(ROOT, out);
    await fs.ensureDir(path.dirname(outPath));
    await fs.writeJson(outPath, report, { spaces: 2 });
    console.log(`Saved integrity report: ${outPath}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((err) => {
  console.error('Integrity check failed:', err);
  process.exit(1);
});

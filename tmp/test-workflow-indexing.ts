import 'dotenv/config';
import { workflowKeywords } from '../src/lib/services/workflow';
import { prisma } from '../src/lib/db';
workflowKeywords('cmue65c2x0001uag8zkfsr6bh')
  .then((result) => console.log(JSON.stringify(result.keywords.filter((row) => row.indexingEvidence).map((row) => ({ keyword: row.keyword, state: row.state, evidence: row.indexingEvidence })))))
  .finally(() => prisma.$disconnect())
  .catch((err) => { console.error(err.message); process.exitCode = 1; });

const { withTransaction } = require('../../database/db');
const config = require('../../config');
const { recordAudit, diff } = require('../audit/audit.recorder');
const { notifyUsers } = require('../notifications/notification.writer');
const { camelize } = require('../../utils/camelize');
const { businessToday } = require('../../utils/time');
const { PREFIXES } = require('../documents/documentNumbers');
const { version } = require('../../../package.json');
const repo = require('./settings.repository');

const TAX_FIELDS = ['taxEnabled', 'taxName', 'taxRate', 'taxMode'];

function toDto(row) {
  const dto = camelize(row);
  dto.taxRate = Number(row.tax_rate).toFixed(3);
  return dto;
}

async function getSettings() {
  return toDto(await repo.get());
}

async function updateSettings(auth, actor, changes) {
  return withTransaction(async (client) => {
    const before = toDto(await repo.get(client, { forUpdate: true }));
    const normalized = { ...changes };
    if (normalized.taxRate !== undefined) normalized.taxRate = Number(normalized.taxRate).toFixed(3);
    const { previous, next, changed } = diff(before, normalized, Object.keys(normalized));
    if (!changed) return before;

    await repo.update(client, changes, auth.userId);
    await recordAudit(client, actor, {
      action: 'SETTINGS_UPDATED',
      entityType: 'SYSTEM_SETTINGS',
      description: `Pharmacy settings updated (${Object.keys(next).join(', ')})`,
      previousValues: previous,
      newValues: next,
    });

    // Tax changes affect every new sale: tell the administrators.
    const taxChanged = Object.keys(next).filter((k) => TAX_FIELDS.includes(k));
    if (taxChanged.length) {
      await notifyUsers(client, await repo.listAdministrators(client, auth.userId), {
        type: 'IMPORTANT_CONFIGURATION_CHANGE',
        title: 'Tax settings changed',
        message: `${actor.userId === auth.userId ? auth.fullName : 'An administrator'} changed tax settings. New sales use the new configuration; past sales are unchanged.`,
        entityType: 'SYSTEM_SETTINGS',
      });
    }
    return toDto(await repo.get(client));
  });
}

/** Non-sensitive system facts only (no infrastructure details or secrets). */
async function getSystemInfo() {
  const info = await repo.systemInfo();
  return {
    application: 'Medicar Pharmacy Management',
    version,
    environment: config.isProduction ? 'production' : config.env,
    businessTimezone: config.businessTimezone,
    businessDate: businessToday(),
    serverTime: new Date().toISOString(),
    schemaVersion: info.latestMigration ? info.latestMigration.name : null,
    counts: camelize(info.counts),
    numbering: {
      format: 'PREFIX-YEAR-SEQUENCE (organization-wide, restarts every year, never reused)',
      prefixes: PREFIXES,
      sequences: camelize(info.sequences),
    },
  };
}

module.exports = { getSettings, updateSettings, getSystemInfo };

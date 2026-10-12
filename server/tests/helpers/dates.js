const { businessToday, addDays } = require('../../src/utils/time');

/** Business-calendar dates relative to today, as 'YYYY-MM-DD'. */
const today = () => businessToday();
const daysFromToday = (n) => addDays(businessToday(), n);

module.exports = { today, daysFromToday };

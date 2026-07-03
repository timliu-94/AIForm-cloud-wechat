function normalizeTitle(value) {
  return String(value || '').trim();
}

function buildDefaultApplicationTitle(country) {
  const countryName = normalizeTitle(country) || '签证';
  return `${countryName}签证`;
}

function stripCompanionSuffix(title) {
  return normalizeTitle(title).replace(/_\d+$/, '');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCompanionApplicationTitle(sourceTitle, applications) {
  const baseTitle = stripCompanionSuffix(sourceTitle) || '同行人申请';
  const usedNumbers = (applications || []).reduce((result, item) => {
    const title = normalizeTitle(item.title);
    const match = title.match(new RegExp(`^${escapeRegExp(baseTitle)}_(\\d+)$`));
    if (match) result.push(Number(match[1]));
    return result;
  }, []);
  let next = 1;
  while (usedNumbers.indexOf(next) >= 0) next += 1;
  return `${baseTitle}_${next}`;
}

module.exports = {
  normalizeTitle,
  buildDefaultApplicationTitle,
  buildCompanionApplicationTitle,
};

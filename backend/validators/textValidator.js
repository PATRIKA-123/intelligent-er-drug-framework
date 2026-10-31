
function textFieldError(name, value, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return `${name} must be a string`;
  }

  if (value.includes("\0")) {
    return `${name} contains an invalid character`;
  }
  if (value.trim().length === 0) {
  return `${name} must not be empty`;
}

  const characterCount = Array.from(value).length;

  if (characterCount > maxLength) {
    return `${name} must be at most ${maxLength} characters`;
  }

  return null;
}

module.exports = {
  textFieldError
};

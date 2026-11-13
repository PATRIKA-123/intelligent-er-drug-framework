
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Verify Gmail SMTP connection
const verifyEmailConnection = async () => {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error("Gmail environment variables are missing");
  }

  return await transporter.verify();
};

// Send email
const sendEmail = async ({ to, subject, html }) => {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error("Gmail environment variables are missing");
  }

  return await transporter.sendMail({
    from: `"Intelligent ER-Drug Framework" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html
  });
};

module.exports = {
  sendEmail,
  verifyEmailConnection
};

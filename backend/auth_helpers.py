import os
import logging
import hashlib
import secrets
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)

# ── Secure Password Hashing ──

def hash_password(password: str) -> str:
    """Hash a password using secure PBKDF2-HMAC-SHA256 with a unique random salt."""
    salt = secrets.token_hex(16)
    iterations = 100000
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        iterations
    )
    # Combined string pattern: pbkdf2:<iterations>:<salt>:<hex_hash>
    return f"pbkdf2:{iterations}:{salt}:{key.hex()}"


def verify_password(stored_password_hash: str, password: str) -> bool:
    """Verify password against its secure PBKDF2-HMAC-SHA256 hash."""
    if not stored_password_hash:
        return False
    try:
        parts = stored_password_hash.split(':')
        if len(parts) != 4 or parts[0] != 'pbkdf2':
            return False
        iterations = int(parts[1])
        salt = parts[2]
        stored_key_hex = parts[3]
        
        key = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt.encode('utf-8'),
            iterations
        )
        return secrets.compare_digest(key.hex(), stored_key_hex)
    except Exception:
        logger.exception("Failed to verify password hash")
        return False


# ── Dual SMTP / Console-Log Verification Mailer ──

def send_verification_email(email: str, name: str, token: str) -> str:
    """Send a 6-digit OTP verification email via Resend API or SMTP if configured.
    
    Returns the 6-digit OTP code for local logging/instant verify benefits.
    """
    resend_key = os.environ.get("RESEND_API_KEY")
    subject = f"{token} is your JobHunter Verification Code"
    
    html_body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; background-color: #0d0e12; color: #ffffff; padding: 24px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #15171e; border: 1px solid #1f2430; border-radius: 12px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);">
          <h2 style="color: #00ffcc; margin-top: 0; text-align: center;">Welcome to JobHunter!</h2>
          <p>Hi {name},</p>
          <p>Thank you for signing up. Please use the following 6-digit verification code to activate your account and start tracking job opportunities:</p>
          
          <div style="margin: 32px 0; text-align: center;">
            <div style="display: inline-block; background-color: #1f2430; border: 1px dashed #00ffcc; border-radius: 8px; padding: 16px 32px; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #00ffcc;">
              {token}
            </div>
          </div>
          
          <p style="font-size: 13px; color: #8892b0; text-align: center;">Enter this code directly in the signup screen to verify your email address and log in.</p>
          <p style="font-size: 12px; color: #8892b0;">If you didn't create an account on JobHunter, you can safely ignore this email.</p>
          <hr style="border: 0; border-top: 1px solid #1f2430; margin: 24px 0;">
          <p style="font-size: 11px; color: #8892b0; text-align: center;">JobHunter Agentic Portal Systems</p>
        </div>
      </body>
    </html>
    """

    # ── Pathway A: Resend Transactional API ──
    if resend_key:
        try:
            import httpx
            sender = os.environ.get("RESEND_SENDER", "onboarding@resend.dev")
            
            res = httpx.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {resend_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": f"JobHunter <{sender}>",
                    "to": [email],
                    "subject": subject,
                    "html": html_body,
                },
                timeout=10.0
            )
            if res.status_code in (200, 201):
                logger.info("Verification OTP email successfully dispatched to %s via Resend API", email)
                return token
            else:
                logger.error("Resend API failed with status %d: %s. Proceeding to SMTP fallback.", res.status_code, res.text)
        except Exception as exc:
            logger.exception("Failed to send verification email via Resend API, trying SMTP fallback")

    # ── Pathway B: Fallback Standard SMTP ──
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASSWORD")
    smtp_sender = os.environ.get("SMTP_SENDER", "noreply@jobhunter.ai")

    if smtp_host and smtp_user and smtp_pass:
        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = smtp_sender
            msg['To'] = email

            part = MIMEText(html_body, 'html')
            msg.attach(part)

            server = smtplib.SMTP(smtp_host, smtp_port)
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_sender, [email], msg.as_string())
            server.quit()
            
            logger.info("Verification OTP email successfully dispatched to %s via SMTP", email)
            return token
        except Exception:
            logger.exception("Failed to send verification email via SMTP, falling back to console logging")

    # ── Pathway C: Fallback Terminal stdout ──
    banner = "=" * 80
    logger.info(
        f"\n{banner}\n"
        f"[DEVELOPER MAILBOX OTP FALLBACK] Verification dispatch for {name} <{email}>\n"
        f"Your 6-Digit Code: {token}\n"
        f"{banner}\n"
    )
    return token

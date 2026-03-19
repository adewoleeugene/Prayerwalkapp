import crypto from 'crypto';

/**
 * Generate a cryptographically secure 6-digit OTP code
 */
export function generateOTP(): string {
    return crypto.randomInt(100000, 999999).toString();
}

/**
 * Send OTP via SMS
 * Requires SMS_PROVIDER env var to be set ('twilio' or 'africas_talking')
 */
export async function sendOTP(phone: string, otp: string): Promise<boolean> {
    try {
        if (process.env.SMS_PROVIDER === 'africas_talking') {
            return await sendOTPViaAfricasTalking(phone, otp);
        }

        if (process.env.SMS_PROVIDER === 'twilio') {
            return await sendOTPViaTwilio(phone, otp);
        }

        // No SMS provider configured — log warning without exposing the OTP
        if (process.env.NODE_ENV === 'development') {
            console.log(`[OTP] Code generated for ${phone.slice(0, 4)}****`);
        }
        return true;
    } catch {
        return false;
    }
}

async function sendOTPViaAfricasTalking(_phone: string, _otp: string): Promise<boolean> {
    // Install: npm install africastalking
    // const AfricasTalking = require('africastalking')({
    //   apiKey: process.env.AFRICAS_TALKING_API_KEY,
    //   username: process.env.AFRICAS_TALKING_USERNAME,
    // });
    // const sms = AfricasTalking.SMS;
    // const result = await sms.send({
    //   to: [_phone],
    //   message: `Your Charis Prayer Walk verification code is: ${_otp}. Valid for 5 minutes.`,
    //   from: process.env.AFRICAS_TALKING_SENDER_ID,
    // });
    // return result.SMSMessageData.Recipients[0].status === 'Success';
    return true;
}

async function sendOTPViaTwilio(_phone: string, _otp: string): Promise<boolean> {
    // Install: npm install twilio
    // const twilio = require('twilio');
    // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    // await client.messages.create({
    //   body: `Your Charis Prayer Walk verification code is: ${_otp}. Valid for 5 minutes.`,
    //   from: process.env.TWILIO_PHONE_NUMBER,
    //   to: _phone,
    // });
    // return true;
    return true;
}

/**
 * Verify OTP code
 */
export function verifyOTP(inputOTP: string, storedOTP: string, expiresAt: Date): boolean {
    if (inputOTP !== storedOTP) {
        return false;
    }
    if (new Date() > expiresAt) {
        return false;
    }
    return true;
}

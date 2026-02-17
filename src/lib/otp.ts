/**
 * OTP (One-Time Password) utilities for phone authentication
 */

/**
 * Generate a 6-digit OTP code
 */
export function generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send OTP via SMS
 * This is a placeholder - integrate with your SMS provider (Twilio, AWS SNS, Africa's Talking, etc.)
 */
export async function sendOTP(phone: string, otp: string): Promise<boolean> {
    try {
        // TODO: Integrate with SMS provider
        // Example with Twilio:
        // const client = twilio(accountSid, authToken);
        // await client.messages.create({
        //   body: `Your Charis Prayer Walk verification code is: ${otp}`,
        //   from: process.env.TWILIO_PHONE_NUMBER,
        //   to: phone
        // });

        // For development, log the OTP
        if (process.env.NODE_ENV === 'development') {
            console.log(`📱 OTP for ${phone}: ${otp}`);
            return true;
        }

        // Example with Africa's Talking (popular in Africa)
        if (process.env.SMS_PROVIDER === 'africas_talking') {
            return await sendOTPViaAfricasTalking(phone, otp);
        }

        // Example with Twilio
        if (process.env.SMS_PROVIDER === 'twilio') {
            return await sendOTPViaTwilio(phone, otp);
        }

        console.warn('No SMS provider configured. OTP:', otp);
        return true;
    } catch (error) {
        console.error('Failed to send OTP:', error);
        return false;
    }
}

/**
 * Send OTP via Africa's Talking
 */
async function sendOTPViaAfricasTalking(phone: string, otp: string): Promise<boolean> {
    try {
        // Install: npm install africastalking
        // const AfricasTalking = require('africastalking')({
        //   apiKey: process.env.AFRICAS_TALKING_API_KEY,
        //   username: process.env.AFRICAS_TALKING_USERNAME,
        // });

        // const sms = AfricasTalking.SMS;
        // const result = await sms.send({
        //   to: [phone],
        //   message: `Your Charis Prayer Walk verification code is: ${otp}. Valid for 5 minutes.`,
        //   from: process.env.AFRICAS_TALKING_SENDER_ID,
        // });

        // return result.SMSMessageData.Recipients[0].status === 'Success';

        console.log('Africa\'s Talking not configured. OTP:', otp);
        return true;
    } catch (error) {
        console.error('Africa\'s Talking error:', error);
        return false;
    }
}

/**
 * Send OTP via Twilio
 */
async function sendOTPViaTwilio(phone: string, otp: string): Promise<boolean> {
    try {
        // Install: npm install twilio
        // const twilio = require('twilio');
        // const client = twilio(
        //   process.env.TWILIO_ACCOUNT_SID,
        //   process.env.TWILIO_AUTH_TOKEN
        // );

        // await client.messages.create({
        //   body: `Your Charis Prayer Walk verification code is: ${otp}. Valid for 5 minutes.`,
        //   from: process.env.TWILIO_PHONE_NUMBER,
        //   to: phone,
        // });

        // return true;

        console.log('Twilio not configured. OTP:', otp);
        return true;
    } catch (error) {
        console.error('Twilio error:', error);
        return false;
    }
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

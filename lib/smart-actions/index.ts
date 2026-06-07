import { SmartActionsEngine } from './engine';
import { OtpDetector } from './detectors/otp';
import { MeetingDetector } from './detectors/meeting';
import { DeliveryDetector } from './detectors/delivery';
import { AccountActionDetector } from './detectors/account';

// Register all detectors
SmartActionsEngine.registerDetector(OtpDetector);
SmartActionsEngine.registerDetector(MeetingDetector);
SmartActionsEngine.registerDetector(DeliveryDetector);
SmartActionsEngine.registerDetector(AccountActionDetector);

export { SmartActionsEngine };
export * from './types';

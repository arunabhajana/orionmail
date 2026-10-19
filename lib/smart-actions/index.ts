import { SmartActionsEngine } from './engine';
import { OtpDetector } from './detectors/otp';
import { MeetingDetector } from './detectors/meeting';
import { DeliveryDetector } from './detectors/delivery';
import { AccountActionDetector } from './detectors/account';
import { CommerceDetector } from './detectors/commerce';
import { TravelDetector } from './detectors/travel';

// Register all detectors
SmartActionsEngine.registerDetector(OtpDetector);
SmartActionsEngine.registerDetector(MeetingDetector);
SmartActionsEngine.registerDetector(DeliveryDetector);
SmartActionsEngine.registerDetector(AccountActionDetector);
SmartActionsEngine.registerDetector(CommerceDetector);
SmartActionsEngine.registerDetector(TravelDetector);

export { SmartActionsEngine };
export * from './types';

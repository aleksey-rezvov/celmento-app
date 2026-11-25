from enum import StrEnum


class ErrorCode(StrEnum):
    VALIDATION_ERROR = "validation_error"
    UNAUTHORIZED = "unauthorized"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    INTERNAL_ERROR = "internal_error"
    EMAIL_INVALID = "email_invalid"
    REGISTRATION_REQUIRED = "registration_required"
    CODE_INVALID = "code_invalid"
    CODE_EXPIRED = "code_expired"
    CODE_LOCKED = "code_locked"
    RESEND_TOO_SOON = "resend_too_soon"
    CONSENT_REQUIRED = "consent_required"
    ORIGIN_INVALID = "origin_invalid"
    REGISTRATION_PACKAGE_INVALID = "registration_package_invalid"
    REGISTRATION_PACKAGE_EXPIRED = "registration_package_expired"
    REGION_LOCKED = "region_locked"
    ACCOUNT_EXISTS = "account_exists"
    ACTIVATION_NOT_OFFERED = "activation_not_offered"
    TICKET_INVALID = "ticket_invalid"
    ACTIVATION_REQUIRED = "activation_required"
    ALREADY_ACTIVATED = "already_activated"
    LOGIN_INVALID = "login_invalid"
    LOGIN_TAKEN = "login_taken"
    LOGIN_RESERVED = "login_reserved"
    WORKING_HOURS_INVALID = "working_hours_invalid"
    LINK_LOGIN_NOT_FOUND = "link_login_not_found"
    LINK_DUPLICATE = "link_duplicate"
    CLIENT_NOT_LINKED = "client_not_linked"
    CLIENT_LIMIT_REACHED = "client_limit_reached"
    CLIENT_ARCHIVED = "client_archived"
    CLIENT_NOT_ARCHIVED = "client_not_archived"
    OUTCOMES_PENDING = "outcomes_pending"
    MEETING_OVERLAP = "meeting_overlap"
    MEETING_NOT_STARTED = "meeting_not_started"
    MEETING_HAS_OUTCOME = "meeting_has_outcome"
    MEETING_NO_OUTCOME = "meeting_no_outcome"
    MEETING_CLIENT_ARCHIVED = "meeting_client_archived"
    OUTCOME_CHOICE_REQUIRED = "outcome_choice_required"
    PAYMENT_TYPE_REQUIRED = "payment_type_required"
    MY_DURATION_INVALID = "my_duration_invalid"
    REFUND_CHOICE_REQUIRED = "refund_choice_required"
    PAYMENT_INVALID = "payment_invalid"
    BALANCE_NOT_ZERO = "balance_not_zero"
    RATE_REQUIRED = "rate_required"
    NOTE_TOO_LONG = "note_too_long"
    NOTE_READ_ONLY = "note_read_only"
    TAG_NOT_ALLOWED = "tag_not_allowed"
    SLOT_TAKEN = "slot_taken"
    SLOT_INVALID = "slot_invalid"
    BOOKING_UNAVAILABLE = "booking_unavailable"
    SELF_BOOKING = "self_booking"
    SUBSCRIPTION_REQUEST_EXISTS = "subscription_request_exists"


class Language(StrEnum):
    RU = "ru"
    EN = "en"


class Contour(StrEnum):
    RU = "ru"
    WORLD = "world"


class Currency(StrEnum):
    RUB = "RUB"
    EUR = "EUR"
    USD = "USD"


class Weekday(StrEnum):
    MON = "mon"
    TUE = "tue"
    WED = "wed"
    THU = "thu"
    FRI = "fri"
    SAT = "sat"
    SUN = "sun"


class Specialization(StrEnum):
    COACH = "coach"
    PSYCHOLOGIST = "psychologist"
    PSYCHOTHERAPIST = "psychotherapist"
    PSYCHOANALYST = "psychoanalyst"
    CONSULTANT = "consultant"
    MENTOR = "mentor"
    OTHER = "other"


class SessionFormat(StrEnum):
    ONLINE = "online"
    IN_PERSON = "in_person"
    BOTH = "both"


class ContactChannel(StrEnum):
    PHONE = "phone"
    TELEGRAM = "telegram"
    WHATSAPP = "whatsapp"
    EMAIL = "email"
    OTHER = "other"


class MeetingType(StrEnum):
    CLIENT_SESSION = "client_session"
    PERSONAL_THERAPY = "personal_therapy"
    SUPERVISION = "supervision"
    TRAINING = "training"
    MUTUAL_PRACTICE = "mutual_practice"


class MeetingStatus(StrEnum):
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    NOT_TAKEN_PLACE = "not_taken_place"


class MeetingPlace(StrEnum):
    ONLINE = "online"
    IN_PERSON = "in_person"


class MeetingSource(StrEnum):
    SPECIALIST = "specialist"
    SELF_BOOKED = "self_booked"


class PaymentType(StrEnum):
    PAID = "paid"
    PRO_BONO = "pro_bono"
    BARTER = "barter"


class FolderColor(StrEnum):
    PINK = "pink"
    BLUE = "blue"
    LILAC = "lilac"
    YELLOW = "yellow"
    GREEN = "green"
    PEACH = "peach"


class ClientCardStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class ClientSource(StrEnum):
    CREATED = "created"
    BOOKED_VIA_LINK = "booked_via_link"


class BalanceOperationKind(StrEnum):
    PAYMENT = "payment"
    SESSION_CHARGE = "session_charge"
    MISSED_CHARGE = "missed_charge"
    REFUND_TO_BALANCE = "refund_to_balance"
    DELETED_MEETING_CHARGE = "deleted_meeting_charge"
    CORRECTION = "correction"


class NoticeTab(StrEnum):
    PEOPLE = "people"
    MEETINGS = "meetings"
    PROFILE = "profile"


class NoticeKey(StrEnum):
    LIMIT_NEW_CLIENT = "notify.limit_new_client"
    ARCHIVED_CLIENT_TRIED = "notify.archived_client_tried"
    INVITE_REGISTERED = "notify.invite_registered"
    LINKED = "client.linked_notice"
    RESCHEDULED = "notify.rescheduled"
    CANCELLED = "notify.cancelled"
    ACCESS_GRANTED = "admin.access_granted"


class LegalDocumentKind(StrEnum):
    TERMS_OF_USE = "terms_of_use"
    PERSONAL_DATA_CONSENT = "personal_data_consent"
    PRIVACY_POLICY = "privacy_policy"
    SPECIALIST_OFFER = "specialist_offer"
    DATA_PROCESSING_INSTRUCTION = "data_processing_instruction"


class AcceptanceKind(StrEnum):
    TERMS_OF_USE = "terms_of_use"
    PERSONAL_DATA_CONSENT = "personal_data_consent"
    SPECIALIST_OFFER = "specialist_offer"
    DATA_PROCESSING_INSTRUCTION = "data_processing_instruction"
    AGE_CONFIRMATION = "age_confirmation"


class ClientLinkStatus(StrEnum):
    STANDALONE = "standalone"
    LINKED = "linked"
    UNLINKED_BY_CLIENT = "unlinked_by_client"


class NoteTagTargetKind(StrEnum):
    CLIENT_CARD = "client_card"
    ACCOUNT = "account"


class AdminFeedbackScreen(StrEnum):
    PROFILE = "profile"


class AdminAction(StrEnum):
    LIST_FEEDBACK = "list_feedback"
    MARK_FEEDBACK_PROCESSED = "mark_feedback_processed"
    GET_STATISTICS = "get_statistics"
    GET_PRESEEDED_NOTES = "get_preseeded_notes"
    REPLACE_PRESEEDED_NOTES = "replace_preseeded_notes"
    LOOKUP_ACCOUNT = "lookup_account"
    GRANT_SUBSCRIPTION = "grant_subscription"
    UPLOAD_LEGAL_DOCUMENT_VERSION = "upload_legal_document_version"
    LIST_RESERVED_LOGIN_WORDS = "list_reserved_login_words"
    ADD_RESERVED_LOGIN_WORD = "add_reserved_login_word"
    LIST_JOURNAL = "list_journal"


class AdminJournalObjectType(StrEnum):
    FEEDBACK = "feedback"
    STATISTICS = "statistics"
    PRESEEDED_NOTES = "preseeded_notes"
    ACCOUNT = "account"
    SUBSCRIPTION = "subscription"
    LEGAL_DOCUMENT = "legal_document"
    RESERVED_LOGIN_WORD = "reserved_login_word"
    JOURNAL = "journal"


class RegistrationIntent(StrEnum):
    LEAD = "lead"
    ATTEND = "attend"


class FeedbackScreen(StrEnum):
    PROFILE = "profile"


class MeetingOutcomeStatus(StrEnum):
    COMPLETED = "completed"
    NOT_TAKEN_PLACE = "not_taken_place"


class NoteFilter(StrEnum):
    ALL = "all"
    MINE = "mine"
    SHARED = "shared"


class LoginAvailabilityStatus(StrEnum):
    AVAILABLE = "available"
    RULE_LENGTH = "rule_length"
    RULE_CHARS = "rule_chars"
    RULE_START = "rule_start"
    RULE_END = "rule_end"
    RULE_DOUBLE = "rule_double"
    TAKEN = "taken"
    RESERVED = "reserved"


class SubscriptionTerm(StrEnum):
    MONTH = "month"
    YEAR = "year"


class SubscriptionRequestSource(StrEnum):
    LIMIT_SCREEN = "limit_screen"
    PROFILE = "profile"


class PriceLevel(StrEnum):
    PARTNER = "partner"
    PROMO = "promo"
    BASE = "base"


class RecordsPeriodKind(StrEnum):
    ALL = "all"
    YEAR = "year"
    MONTH = "month"
    WEEK = "week"
    CUSTOM = "custom"


class RecordsOperationFilter(StrEnum):
    ALL = "all"
    INCOME = "income"
    RECEIPTS = "receipts"
    EXPENSES = "expenses"


class RecordsOperationKind(StrEnum):
    SESSION_CHARGE = "session_charge"
    MISSED_CHARGE = "missed_charge"
    PAYMENT = "payment"
    SERVICE_EXPENSE = "service_expense"


class RecordsHoursLogType(StrEnum):
    PRACTICE = "practice"
    SUPERVISION = "supervision"
    THERAPY = "therapy"
    TRAINING = "training"

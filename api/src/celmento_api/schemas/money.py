from decimal import Decimal
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

from celmento_api.models.enums import Currency

DecimalAmount = Annotated[str, Field(pattern=r"^-?[0-9]+(\.[0-9]{1,2})?$")]
AMOUNT_MAX_EXCLUSIVE: Decimal = Decimal(1000000000000000)


def validate_amount_size(value: str) -> str:
    if Decimal(value).copy_abs() >= AMOUNT_MAX_EXCLUSIVE:
        raise ValueError("Amount is outside the supported range")
    return value


def validate_rate(value: str) -> str:
    if Decimal(value) < 0:
        raise ValueError("Rate cannot be negative")
    return value


StoredAmount = Annotated[DecimalAmount, AfterValidator(validate_amount_size)]
Rate = Annotated[StoredAmount, AfterValidator(validate_rate)]


class Money(BaseModel):
    amount: DecimalAmount
    currency: Currency


def format_amount(amount: Decimal) -> str:
    if amount.is_zero():
        return "0"
    text = format(amount, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text

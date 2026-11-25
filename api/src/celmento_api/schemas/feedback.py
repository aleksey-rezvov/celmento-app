from typing import Annotated, ClassVar

from pydantic import BaseModel, ConfigDict, Field

from celmento_api.models.enums import FeedbackScreen


class FeedbackCreate(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    text: Annotated[str, Field(min_length=1, max_length=5000, pattern=r"^[^\x00]*$")]
    screen: FeedbackScreen

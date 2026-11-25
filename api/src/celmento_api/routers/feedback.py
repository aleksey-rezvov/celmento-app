from fastapi import APIRouter, Response

from celmento_api.auth import Database, SignedInAccount
from celmento_api.errors import error_responses
from celmento_api.models.feedback import FeedbackMessage
from celmento_api.schemas.feedback import FeedbackCreate

router: APIRouter = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post(
    "",
    operation_id="sendFeedback",
    summary="Send a free-text product suggestion",
    status_code=204,
    response_class=Response,
    response_model=None,
    responses=error_responses(401, 422, 500),
)
async def send_feedback(
    body: FeedbackCreate, account: SignedInAccount, session: Database
) -> Response:
    # spec:impl product-feedback#store-send-text-account-email
    # spec:impl product-feedback#store-message-account-contour-readable
    # spec:impl product-feedback#accept-number-messages-account-storing
    # spec:impl product-feedback#attach-other-user-data-message
    # spec:impl product-feedback#deliver-feedback-email-channel-other
    session.add(
        FeedbackMessage(
            account_id=account.account_id,
            activated=account.activated_at is not None,
            screen=body.screen.value,
            text=body.text,
        )
    )
    await session.commit()
    return Response(status_code=204)

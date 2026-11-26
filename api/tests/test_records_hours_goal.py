from asyncio import gather

from test_account import AccountStand, account_stand
from test_clients_api import bearer, problem
from test_records_api import RECORDS, records_from

from celmento_api.models.enums import ErrorCode
from celmento_api.schemas.records import RecordsHoursGoal, RecordsHoursGoalResult

__all__: list[str] = ["account_stand"]

GOAL: str = f"{RECORDS}/hours/goal"


# spec:test records-hours-goal#leader-goal-per-log
async def test_hours_goals_require_activation_and_stay_in_their_log_and_account(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    owner = await stand.add_account("hours_goals_owner")
    peer = await stand.add_account("hours_goals_peer")
    client, headers = stand.client, bearer(owner)
    practice = {"type": "practice"}
    supervision = {"type": "supervision"}
    certification = {"hours": "500", "label": "PCC"}
    for method in ("GET", "PUT", "DELETE"):
        body = certification if method == "PUT" else None
        problem(
            await client.request(method, GOAL, params=practice, json=body),
            401,
            ErrorCode.UNAUTHORIZED,
        )
        problem(
            await client.request(
                method, GOAL, params=practice, headers=headers, json=body
            ),
            403,
            ErrorCode.ACTIVATION_REQUIRED,
        )
    await stand.activate(owner)
    await stand.activate(peer)
    initial = records_from(
        await client.get(GOAL, params=practice, headers=headers), RecordsHoursGoalResult
    )
    assert initial.goal is None

    responses = await gather(
        *(
            client.put(GOAL, params=practice, headers=headers, json=body)
            for body in (certification, {"hours": "750", "label": "Advanced practice"})
        )
    )
    saved_practice = [
        records_from(response, RecordsHoursGoalResult).goal for response in responses
    ]
    assert saved_practice == [
        RecordsHoursGoal(hours="500", label="PCC"),
        RecordsHoursGoal(hours="750", label="Advanced practice"),
    ]
    current = records_from(
        await client.get(GOAL, params=practice, headers=headers), RecordsHoursGoalResult
    )
    assert current.goal in saved_practice
    assert (
        records_from(
            await client.get(GOAL, params=practice, headers=bearer(peer)),
            RecordsHoursGoalResult,
        ).goal
        is None
    )

    supervision_goal = {"hours": "37.5", "label": "Supervision target"}
    records_from(
        await client.put(
            GOAL, params=supervision, headers=headers, json=supervision_goal
        ),
        RecordsHoursGoalResult,
    )
    peer_headers = bearer(peer)
    records_from(
        await client.put(
            GOAL, params=practice, headers=peer_headers, json=certification
        ),
        RecordsHoursGoalResult,
    )
    deleted = await client.delete(GOAL, params=practice, headers=headers)
    assert deleted.status_code == 204 and deleted.content == b""
    assert (
        records_from(
            await client.get(GOAL, params=practice, headers=headers),
            RecordsHoursGoalResult,
        ).goal
        is None
    )
    assert records_from(
        await client.get(GOAL, params=supervision, headers=headers),
        RecordsHoursGoalResult,
    ).goal == RecordsHoursGoal.model_validate(supervision_goal)
    assert records_from(
        await client.get(GOAL, params=practice, headers=peer_headers),
        RecordsHoursGoalResult,
    ).goal == RecordsHoursGoal.model_validate(certification)


# spec:test records-hours-goal#validate-change
async def test_hours_goal_validates_edits_and_repeated_deletion(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    owner = await stand.add_account("hours_goals_validated_owner")
    await stand.activate(owner)
    client, headers = stand.client, bearer(owner)
    training = {"type": "training"}
    first = records_from(
        await client.put(
            GOAL,
            params=training,
            headers=headers,
            json={"hours": "0.01", "label": "  Training target \t"},
        ),
        RecordsHoursGoalResult,
    )
    assert first.goal == RecordsHoursGoal(hours="0.01", label="Training target")

    for params in ({}, {"type": "growth"}):
        assert (
            await client.get(GOAL, params=params, headers=headers)
        ).status_code == 422
        assert (
            await client.put(
                GOAL,
                params=params,
                headers=headers,
                json={"hours": "1", "label": "Goal"},
            )
        ).status_code == 422
        assert (
            await client.delete(GOAL, params=params, headers=headers)
        ).status_code == 422

    for body in (
        {"hours": "0", "label": "Goal"},
        {"hours": "-1", "label": "Goal"},
        {"hours": "100000", "label": "Goal"},
        {"hours": "0.001", "label": "Goal"},
        {"hours": "1e3", "label": "Goal"},
        {"hours": 25, "label": "Goal"},
        {"hours": "25", "label": "  "},
        {"hours": "25", "label": "a" * 121},
        {"hours": "25", "label": "Goal\x00"},
        {"hours": "25", "label": "Goal", "extra": "Invalid"},
        {"hours": "25"},
    ):
        assert (
            await client.put(GOAL, params=training, headers=headers, json=body)
        ).status_code == 422
    assert (
        records_from(
            await client.get(GOAL, params=training, headers=headers),
            RecordsHoursGoalResult,
        )
        == first
    )

    updated = {"hours": "99999.99", "label": "a" * 120}
    saved = records_from(
        await client.put(GOAL, params=training, headers=headers, json=updated),
        RecordsHoursGoalResult,
    )
    assert saved.goal == RecordsHoursGoal.model_validate(updated)
    assert (
        records_from(
            await client.get(GOAL, params=training, headers=headers),
            RecordsHoursGoalResult,
        )
        == saved
    )
    for _ in range(2):
        deleted = await client.delete(GOAL, params=training, headers=headers)
        assert deleted.status_code == 204 and deleted.content == b""
    assert (
        records_from(
            await client.get(GOAL, params=training, headers=headers),
            RecordsHoursGoalResult,
        ).goal
        is None
    )

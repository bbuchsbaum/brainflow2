export type BidsParticipantRow = {
    participant_id: string;
    values: {
        [key in string]?: string;
    };
};
